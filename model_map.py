"""The real parts behind the Brain view's nodes.

The Brain view's COGNITION CORE stands for the language model and its VOCODER for the voice model.
When their files are on this computer, this module reads their headers (never the weights
themselves) and lists the real parts: each layer's attention, its expert networks or feed-forward
block, the router, the word-lookup table, the next-word scorer and the drafter, with how many
weights each holds. The page then pins each node to one of them. The other subsystems are program
code, not weights, so they map to the functions that do their work.

What this can't show is which weights fire for a given word: model servers don't report that.

Formats: GGUF (llama.cpp, Ollama, LM Studio), Halogen .hgn, PyTorch .pt (F5-TTS), .safetensors.
The language model file comes from the "Language model file" setting, else llama.cpp's /props
(model_path), else Ollama's manifest for the configured model id.
"""
from __future__ import annotations

import collections
import json
import math
import os
import pickle
import re
import struct
import zipfile
from pathlib import Path

import requests

import config

_cache: dict[tuple, dict] = {}


# ── readers: tensor names and shapes only ────────────────────────────────────────

def read_gguf(path: Path) -> tuple[dict, list[tuple[str, tuple]]]:
    """GGUF v2/v3 header: metadata (scalars and strings; arrays as their length) and the tensor list."""
    with open(path, "rb", buffering=1 << 20) as f:
        if f.read(4) != b"GGUF":
            raise ValueError("not a GGUF file")
        version, = struct.unpack("<I", f.read(4))
        if version < 2:
            raise ValueError("GGUF v1 is not supported")
        n_tensors, n_kv = struct.unpack("<QQ", f.read(16))

        def rstr() -> str:
            n, = struct.unpack("<Q", f.read(8))
            return f.read(n).decode("utf-8", "replace")

        scalar = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}

        def rval(t: int):
            if t in scalar:
                fmt = scalar[t]
                return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]
            if t == 8:
                return rstr()
            if t == 9:
                et, n = struct.unpack("<IQ", f.read(12))
                if et in scalar:
                    f.seek(struct.calcsize(scalar[et]) * n, os.SEEK_CUR)
                else:
                    for _ in range(n):
                        rval(et)
                return {"array_length": n}
            raise ValueError(f"unknown GGUF value type {t}")

        meta = {}
        for _ in range(n_kv):
            key = rstr()
            t, = struct.unpack("<I", f.read(4))
            meta[key] = rval(t)
        tensors = []
        for _ in range(n_tensors):
            name = rstr()
            nd, = struct.unpack("<I", f.read(4))
            dims = struct.unpack(f"<{nd}Q", f.read(8 * nd))
            f.read(12)  # type (u32) + offset (u64)
            tensors.append((name, tuple(reversed(dims))))   # GGUF lists the fastest-moving dimension first
    return meta, tensors


def read_hgn(path: Path) -> list[tuple[str, tuple]]:
    """Halogen .hgn: 'HGN1', u32 version, u32 count, then 160-byte entries from byte 104
    (name[96], u32 dtype, u32 ndim, u64 shape[4], u64 offset, u64 nbytes, u64 checksum)."""
    with open(path, "rb") as f:
        hdr = f.read(104)
        if hdr[:4] != b"HGN1":
            raise ValueError("not an HGN1 file")
        n = struct.unpack_from("<I", hdr, 8)[0]
        data = f.read(160 * n)
    out = []
    for i in range(n):
        e = data[i * 160:(i + 1) * 160]
        name = e[:96].split(b"\0")[0].decode()
        _dt, nd = struct.unpack_from("<II", e, 96)
        out.append((name, struct.unpack_from("<4Q", e, 104)[:nd]))
    return out


def read_safetensors(path: Path) -> list[tuple[str, tuple]]:
    with open(path, "rb") as f:
        n, = struct.unpack("<Q", f.read(8))
        header = json.loads(f.read(n))
    return [(k, tuple(v["shape"])) for k, v in header.items() if k != "__metadata__"]


class _T:
    def __init__(self, shape): self.shape = tuple(shape)


class _Stub:
    def __init__(self, *a, **k): pass
    def __setstate__(self, s): pass


def read_pt(path: Path) -> list[tuple[str, tuple]]:
    """A PyTorch zip checkpoint's tensor shapes, from its data.pkl, without torch or the weights.
    The unpickler only allows the names a state dict needs and refuses everything else, so a
    tampered file can't run code here."""
    allowed = {("torch._utils", "_rebuild_tensor_v2"): lambda storage, offset, size, *rest: _T(size),
               ("torch._utils", "_rebuild_parameter"): lambda t, *a: t,
               ("collections", "OrderedDict"): collections.OrderedDict}

    class Safe(pickle.Unpickler):
        def find_class(self, mod, name):
            if (mod, name) in allowed:
                return allowed[(mod, name)]
            if mod == "torch" and name.endswith("Storage"):
                return _Stub
            raise pickle.UnpicklingError(f"refused {mod}.{name}")

        def persistent_load(self, pid):
            return _Stub()

    with zipfile.ZipFile(path) as z:
        pkl = next(n for n in z.namelist() if n.endswith("data.pkl"))
        obj = Safe(z.open(pkl)).load()
    out = []

    def walk(o, pre=""):
        if isinstance(o, _T):
            out.append((pre, o.shape))
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(v, f"{pre}.{k}" if pre else str(k))
    walk(obj)
    return out


def read_any(path: Path) -> tuple[str, dict, list[tuple[str, tuple]]]:
    with open(path, "rb") as f:
        head = f.read(4)
    if head == b"GGUF":
        meta, tensors = read_gguf(path)
        return "gguf", meta, tensors
    if head == b"HGN1":
        return "hgn", {}, read_hgn(path)
    if head[:2] == b"PK":
        return "pt", {}, read_pt(path)
    if path.suffix == ".safetensors":
        return "safetensors", {}, read_safetensors(path)
    raise ValueError("unrecognised model file")


# ── grouping tensors into the parts people can understand ───────────────────────

_LAYER = re.compile(r"(?:^|\.)(?:layers|blk|h|blocks)\.(\d+)\.")
_SCALES = (".suh", ".svh", ".su")   # Halogen quantisation scales, not weights


def llm_kind(name: str) -> str:
    n = name.lower()
    if n.startswith("mtp.") or ".nextn." in n or "nextn_" in n:
        return "drafter"
    if "embed_tokens" in n or n.startswith("token_embd") or "wte" in n:
        return "embedding"
    if n.startswith("lm_head") or n in ("output.weight",) or n.startswith("output."):
        return "output"
    if "shared_expert_gate" in n or "ffn_gate_inp" in n or re.search(r"mlp\.gate\.weight$", n) or ".router." in n:
        return "router"
    if "shared_expert" in n or "shexp" in n:
        return "shared"
    if "experts" in n or "_exps" in n:
        return "experts"
    if "linear_attn" in n or "ssm_" in n or "mamba" in n:
        return "linear_attention"
    if "self_attn" in n or re.search(r"\.attn_(q|k|v|qkv|output|q_a|q_b|kv_a|kv_b)", n) or ".attn." in n or ".attention." in n:
        return "attention"
    if re.search(r"(mlp|ffn)[._](gate|up|down)", n) or ".mlp." in n or ".ffn" in n:
        return "ffn"
    if "hyper_connection" in n:
        return "mixing"
    if "norm" in n:
        return "norm"
    return "other"


def voice_kind(name: str) -> tuple[str, int | None]:
    m = re.search(r"transformer_blocks\.(\d+)\.", name)
    if m:
        return "voice_block", int(m.group(1))
    for key, kind in (("text_embed", "voice_text"), ("input_embed", "voice_input"), ("time_embed", "voice_time"),
                      ("proj_out", "voice_output"), ("norm_out", "voice_output"), ("mel_spec", "voice_mel")):
        if key in name:
            return kind, None
    return "voice_other", None


def _summarise(units: dict) -> list[dict]:
    out = []
    for (kind, layer), u in units.items():
        u["tensors"].sort(key=lambda t: -t[2])
        out.append({"kind": kind, "layer": layer, "weights": u["weights"],
                    "tensors": [{"name": n, "shape": list(s)} for n, s, _ in u["tensors"][:3]], "count": len(u["tensors"])})
    order = {"embedding": 0, "attention": 1, "linear_attention": 1, "mixing": 2, "router": 3, "shared": 4, "experts": 5,
             "ffn": 5, "norm": 6, "other": 7, "output": 8, "drafter": 9,
             "voice_text": 0, "voice_input": 1, "voice_time": 2, "voice_block": 3, "voice_output": 8, "voice_mel": 9, "voice_other": 7}
    def rank(u):
        o = order.get(u["kind"], 7)
        if u["layer"] is not None:
            return (1, u["layer"], o)            # the layers, in order
        return (0, 0, o) if o < 3 else (2, 0, o)  # what comes before them (word lookup), and after (scorer, drafter)
    out.sort(key=rank)
    return out


def describe_llm(path: Path) -> dict:
    fmt, meta, tensors = read_any(path)
    units: dict = collections.OrderedDict()
    total = 0
    n_experts = 0
    arch0 = meta.get("general.architecture", "")
    blocks, nextn = meta.get(f"{arch0}.block_count"), meta.get(f"{arch0}.nextn_predict_layers") or 0
    for name, shape in tensors:
        if name.endswith(_SCALES):
            continue
        size = math.prod(shape) if shape else 0
        kind = llm_kind(name)
        m = _LAYER.search(name)
        layer = int(m.group(1)) if m and kind not in ("drafter",) else None
        if layer is not None and blocks and nextn and layer >= blocks - nextn:
            kind, layer = "drafter", None   # GGUF keeps the drafter (MTP) as the last block(s)
        u = units.setdefault((kind, layer), {"weights": 0, "tensors": []})
        u["weights"] += size
        u["tensors"].append((name, shape, size))
        total += size
        if kind == "experts" and len(shape) == 3:
            n_experts = max(n_experts, shape[0])
    # In hybrid models a fast-attention layer also has q/k/v-style tensors (and a gate): they belong to
    # its linear attention, not to a second, full attention.
    for l in {l for (k, l) in units if k == "linear_attention" and l is not None}:
        for k in ("attention", "other"):
            extra = units.pop((k, l), None)
            if extra:
                units[("linear_attention", l)]["weights"] += extra["weights"]
                units[("linear_attention", l)]["tensors"] += extra["tensors"]
    arch = arch0
    layers = sorted({l for (_, l) in units if l is not None})
    full = sorted({l for (k, l) in units if k == "attention" and l is not None})
    linear = sorted({l for (k, l) in units if k == "linear_attention" and l is not None})
    return {
        "file": path.name, "format": fmt, "arch": arch or None,
        "name": meta.get("general.name"),
        "layers": len(layers), "total": total,
        "experts": meta.get(f"{arch}.expert_count") or n_experts or None,
        "experts_used": meta.get(f"{arch}.expert_used_count"),
        "hidden": meta.get(f"{arch}.embedding_length"),
        "context": meta.get(f"{arch}.context_length"),
        "full_attention_layers": len(full) if linear else None,
        "linear_attention_layers": len(linear) or None,
        "units": _summarise(units),
    }


def describe_voice(path: Path) -> dict:
    fmt, _meta, tensors = read_any(path)
    units: dict = collections.OrderedDict()
    total = 0
    for name, shape in tensors:
        size = math.prod(shape) if shape else 0
        if size <= 1:
            continue   # counters such as the EMA step
        name = re.sub(r"^(ema_model_state_dict\.|model_state_dict\.)?(ema_model\.)?", "", name)   # checkpoint wrappers
        kind, block = voice_kind(name)
        u = units.setdefault((kind, block), {"weights": 0, "tensors": []})
        u["weights"] += size
        u["tensors"].append((name, shape, size))
        total += size
    blocks = sorted({b for (k, b) in units if k == "voice_block"})
    return {"file": path.name, "format": fmt, "total": total, "blocks": len(blocks), "units": _summarise(units)}


# ── finding the files ────────────────────────────────────────────────────────────

def _llm_path() -> tuple[Path | None, str]:
    configured = (config.get("llm_model_file") or "").strip()
    if configured:
        p = Path(os.path.expanduser(configured))
        return (p, "setting") if p.is_file() else (None, f"the configured file was not found: {configured}")
    base = re.sub(r"/v1/.*$", "", config.get("llm_url") or "").rstrip("/")
    try:   # llama.cpp says which file it serves
        props = requests.get(base + "/props", headers=config.llm_headers(), timeout=2).json()
        mp = props.get("model_path")
        if mp and Path(mp).is_file():
            return Path(mp), "llama.cpp"
    except Exception:
        pass
    model = (config.get("llm_model") or "").strip()
    if model and (":" in model or "/" not in model):
        name, _, tag = model.partition(":")
        mf = Path.home() / ".ollama/models/manifests/registry.ollama.ai" / ("library/" + name if "/" not in name else name) / (tag or "latest")
        try:
            layers = json.loads(mf.read_text())["layers"]
            digest = next(l["digest"] for l in layers if l.get("mediaType", "").endswith(".model"))
            blob = Path.home() / ".ollama/models/blobs" / digest.replace(":", "-")
            if blob.is_file():
                return blob, "ollama"
        except Exception:
            pass
    return None, "no language model file found on this computer (set Settings → Language model file to show its real layers)"


def _voice_path() -> Path | None:
    try:
        from tts_engine import CHECKPOINT
        p = Path(CHECKPOINT)
        return p if p.is_file() and p.stat().st_size > 0 else None
    except Exception:
        return None


def describe() -> dict:
    """What the Brain view can pin its nodes to. Cached until a file changes."""
    out: dict = {}
    llm, how = _llm_path()
    if llm:
        key = ("llm", str(llm), llm.stat().st_mtime)
        try:
            if key not in _cache:
                _cache[key] = describe_llm(llm)
            out["llm"] = {**_cache[key], "found_by": how}
        except Exception as e:
            out["llm_error"] = f"could not read {llm.name}: {e}"
    else:
        out["llm_error"] = how
    voice = _voice_path()
    if voice:
        key = ("voice", str(voice), voice.stat().st_mtime)
        try:
            if key not in _cache:
                _cache[key] = describe_voice(voice)
            out["voice"] = _cache[key]
        except Exception as e:
            out["voice_error"] = f"could not read {voice.name}: {e}"
    return out
