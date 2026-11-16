"""Full written reports (site assessments, inspection or service reports, proposals...) made
from meeting notes, as PDFs.

write_report() picks the source notes, then a background thread asks the language model for
the whole write-up in one long call, saves it as Markdown in <vault>/Delamain/Reports/ and
prints that to a PDF beside it with headless Chromium. When it is done, `notify` (set by
main) tells whoever is there. Editing the Markdown in Obsidian and asking for the PDF again
(remake_report_pdf) re-prints it without rewriting a word.
"""
from __future__ import annotations

import difflib
import html
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from markdown_it import MarkdownIt

import config

REPORTS_FOLDER = "Delamain/Reports"
MEETINGS_FOLDER = "Delamain/Meetings"
SOURCE_CHARS = 120_000        # notes text sent with the request (about 30k tokens)
MAX_TOKENS = 12_000           # room for a long report

# Set by main: generate(system, user, max_tokens) -> str makes one long LLM call (and shows it
# in the Brain view); notify(info: dict) is called from this thread when a report is done or failed.
generate = None
notify = None

_lock = threading.Lock()
_running: dict | None = None


SYSTEM = """You write professional field reports from meeting notes and transcripts, for the person who \
recorded them to hand to a client, a manager or a file. Write the complete document in Markdown.

Ground rules, which matter more than polish:
- Use only what is in the notes and transcript. Each note's summary was machine-written and can be \
wrong; the transcript is the authority. Never invent names, measurements, model numbers, \
quantities, prices, dates, code references or findings. The transcript is automatic speech \
recognition, so fix obvious mis-hearings of ordinary words, but keep anything uncertain marked.
- Where a section needs something that was not said, write "*To confirm:*" and what is needed, \
rather than guessing. Gather all of these in the "Information still needed" section as well.
- Attribute opinions and requests to the person who said them, when that is clear.
- Never quote or reuse a mis-heard word from the transcript (e.g. "Ruba" for Aruba): write the real \
name when it is clear, or "*To confirm:*" when it is not.
- Due dates and owners only as they were said; otherwise "*To confirm*".
- Plain, precise, professional English. No filler, no marketing tone, no mention of AI, \
transcripts or recordings in the body (say "on site", "during the walkthrough", "discussed").
- Use headings (##, ###), short paragraphs, numbered findings, and Markdown tables where they \
help (equipment lists, findings with priority, action items). No HTML.

Start with exactly one line `TITLE: <report title>`, then a blank line, then the report. Do not \
repeat the title as a heading; the cover block shows it."""

CHECK_SYSTEM = """You fact-check a field report against its source: meeting notes whose summary was \
machine-written (it can be wrong) and a transcript (authoritative, but speech recognition, so ordinary \
words may be mis-heard).

Find every specific detail in the draft that the TRANSCRIPT does not actually state: names, roles, \
makes and models, counts, port counts, ages, years, versions, dates, measurements, prices, locations, \
causes, history ("replaced", "installed in"), scope statements, and who said or agreed to what. Jokes, \
guesses, habits and asides in the transcript are not facts. Where the summary and transcript disagree, \
the transcript wins. Professional recommendations, impact and risk statements and general industry \
knowledge (such as an operating system's end of support) are fine unless they rest on an unsupported detail. \
Product and company names in their correct spelling (Netgear, CrowdStrike, SonicWall) are fine where the \
transcript has a mis-heard version of them; never "correct" a name to the transcript's mis-hearing.

Answer with JSON only, no reasoning or commentary: a list of objects {"quote": "...", "fix": "..."}.
- quote: the unsupported text copied EXACTLY from the draft, as short as possible but unique (a phrase, \
a table cell's text, or one sentence).
- fix: the replacement TEXT that goes in its place (never an instruction like "remove this row"): the \
transcript's own version if it has one, "*To confirm:* <what>" if the report needs the detail, or "" to \
remove the quoted text.
List ONLY details that are unsupported; never list one that is fine. At most 25 items, the most \
important first. Return [] if everything is supported."""

STRUCTURES = {
    "site assessment": """Sections, in order (leave out one only if nothing at all applies):
## Executive summary  (5-8 sentences: purpose, overall condition, the most important findings and what is recommended first)
## Site and scope  (site, location, date of visit, who attended and their roles, what was assessed; list exclusions only if they were said)
## Existing conditions  (systems, equipment and controls observed, grouped by system or area; a table of equipment where useful)
## Findings  (numbered; for each: what was found, where, why it matters, and a priority: Critical / High / Medium / Low)
## Recommendations  (numbered, linked to findings, in order of priority; say what would be needed, not prices unless stated)
## Action items  (table: Action | Owner | Due, from what was agreed)
## Information still needed
## Next steps""",
    "default": """Use the sections a professional {kind} would normally have, always including an executive \
summary at the start, numbered findings or points with priorities where they fit, recommendations, an action \
item table (Action | Owner | Due) and "Information still needed". Order them as that kind of document usually is.""",
}


def _vault() -> Path:
    return config.vault().resolve()


def _rel(p: Path) -> str:
    return str(p.relative_to(_vault()))


def _safe_name(title: str) -> str:
    s = re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|#^\[\]]+', " ", title)).strip()
    return s[:90] or "Report"


def _note_in_vault(path: str) -> Path | None:
    rel = (path or "").strip().lstrip("/")
    if not rel:
        return None
    if not rel.lower().endswith(".md"):
        rel += ".md"
    p = (_vault() / rel).resolve()
    if p.is_relative_to(_vault()) and p.is_file() and not any(x.startswith(".") for x in p.relative_to(_vault()).parts):
        return p
    return None


def _meeting_notes() -> list[Path]:
    folder = _vault() / MEETINGS_FOLDER
    return sorted(folder.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True) if folder.is_dir() else []


def find_sources(notes: list[str] | None) -> list[Path]:
    """Each entry is a vault path, or words to look for in the meeting notes (newest match wins);
    'latest' or nothing means the newest meeting, 'today' every meeting from today."""
    meetings = _meeting_notes()
    found: list[Path] = []
    for want in notes or ["latest"]:
        want = (want or "").strip()
        exact = _note_in_vault(want)
        if exact:
            found.append(exact)
            continue
        low = want.lower()
        if low in ("", "latest", "last", "newest", "last meeting", "latest meeting", "the last meeting"):
            found += meetings[:1]
            continue
        if low in ("today", "today's meeting", "todays meeting", "today's meetings"):
            day = datetime.now().strftime("%Y-%m-%d")
            found += [p for p in meetings if p.name.startswith(day)][:6]
            continue
        words = [w for w in re.findall(r"[\w'-]+", low) if len(w) > 2]
        for p in meetings:
            hay = p.stem.lower()
            if words and all(w in hay for w in words):
                found.append(p)
                break
        else:
            for p in meetings:
                text = p.read_text(encoding="utf-8", errors="replace").lower()
                if words and all(w in text for w in words):
                    found.append(p)
                    break
    seen, out = set(), []
    for p in found:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _source_text(paths: list[Path]) -> str:
    budget = SOURCE_CHARS
    parts = []
    for p in paths:
        text = p.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)   # drop the note's frontmatter
        # A meeting note's own summary was machine-written and can carry mistakes into the report, so
        # only its heading and recording line go in, then the transcript itself.
        if "\n## Transcript" in text:
            head, transcript = text.split("\n## Transcript", 1)
            intro = "\n".join(l for l in head.splitlines()[:4] if l.startswith(("# ", "*Recorded")))
            text = f"{intro}\n\n## Transcript{transcript}"
        share = max(4000, budget // max(1, len(paths) - len(parts)))
        if len(text) > share:
            text = text[:share] + "\n\n[... the rest of this transcript was too long to include]"
        budget -= len(text)
        parts.append(f"===== NOTE: {p.stem} =====\n{text.strip()}")
    return "\n\n".join(parts)


def write_report(kind: str = "site assessment", notes: list[str] | None = None, instructions: str = "",
                 prepared_for: str = "", prepared_by: str = "") -> str:
    """Start writing a report in the background; returns at once with what it is working from."""
    global _running
    if generate is None:
        return "Reports are not available right now."
    if isinstance(notes, str):
        notes = [notes]
    sources = find_sources(notes)
    if not sources:
        return ("No matching meeting notes were found. Say which meeting (its title or a few words from it), "
                "or record one first.")
    with _lock:
        if _running:
            return f"Already writing the {_running['kind']} from {_running['from']}; one at a time. It will be announced when ready."
        kind = (kind or "site assessment").strip()
        _running = {"kind": kind, "from": ", ".join(p.stem for p in sources), "started": time.time()}
    threading.Thread(target=_work, args=(kind, sources, instructions, prepared_for, prepared_by),
                     daemon=True, name="report").start()
    return (f"Writing a full {kind} from: {', '.join(p.stem for p in sources)}. It takes a few minutes; it will be "
            f"saved as a PDF in {REPORTS_FOLDER} and announced when ready. Tell the passenger so, briefly.")


def _work(kind: str, sources: list[Path], instructions: str, prepared_for: str, prepared_by: str) -> None:
    global _running
    info: dict = {"kind": kind, "ok": False}
    try:
        structure = STRUCTURES.get(kind.lower(), STRUCTURES["default"].format(kind=kind))
        user = (f"Write a full {kind}.\n{structure}\n\n"
                + (f"Prepared for: {prepared_for}\n" if prepared_for else "")
                + (f"Extra instructions from the person asking: {instructions}\n" if instructions else "")
                + "\nThe source (each meeting's title, when it was recorded, and its full transcript):\n\n" + _source_text(sources))
        source = _source_text(sources)
        draft = _clean(generate(SYSTEM, user, MAX_TOKENS))
        if len(draft) < 200:
            raise RuntimeError("the model returned almost nothing")
        with _lock:
            if _running:
                _running["stage"] = "checking"
        # A second pass checks every specific against the transcript: a report goes to clients.
        text = check_facts(draft, source)
        m = re.match(r"\s*TITLE:\s*(.+)", text)
        title = m.group(1).strip().strip('"*# ') if m else f"{kind.title()}"
        body = text[m.end():].strip() if m else text
        if len(body) < 200:
            raise RuntimeError("the model returned almost nothing")
        md = _save_markdown(kind, title, body, sources, prepared_for, prepared_by)
        pdf = render_pdf(md)
        info.update(ok=True, title=title, pdf=_rel(pdf), markdown=_rel(md))
        print(f"[Report] {kind} ready: {_rel(pdf)}")
    except Exception as e:
        info["error"] = str(e)[:300]
        print(f"[Report] {kind} failed: {e}")
    finally:
        with _lock:
            _running = None
    if notify:
        try:
            notify(info)
        except Exception as e:
            print(f"[Report] notify failed: {e}")


_NUM_WORDS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
              "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
              "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100}
_COMMON = set("""a an and are as at be but by for from has have in is it its of on or that the this these those to was
were will with not no all any each per via into over under within without about after before during between
executive summary site scope existing conditions findings finding recommendations recommendation action actions
items item information still needed next steps owner due priority critical high medium low observation impact
location notes details device type quantity count status condition client provider representative attendees date
visit assessment report network infrastructure end user users devices software operating systems total
regular specialized machines yes none unknown confirm tbd n/a na""".split())


def _num_in(src: str, n: int, unit: str = "") -> bool:
    words = [w for w, v in _NUM_WORDS.items() if v == n]
    forms = [str(n)] + words
    if not unit:
        return any(re.search(rf"(?<![\w.]){re.escape(f)}(?![\w])", src) for f in forms)
    u = unit.lower().rstrip("s")
    return any(re.search(rf"(?<![\w.]){re.escape(f)}[\s-]*{re.escape(u)}", src) for f in forms)


def _missing_details(draft: str, transcript: str) -> list[str]:
    """Specifics in the draft that never occur in the transcript: numbers (with their unit, when they
    have one) and names in the middle of a sentence (makes, models, people, places)."""
    src = re.sub(r"\s+", " ", transcript.lower())
    body = re.sub(r"^TITLE:.*$", "", draft, flags=re.M)
    body = re.sub(r"^#.*$", "", body, flags=re.M)                          # headings
    body = re.sub(r"\*\*[^*\n]{1,80}?\*\*", " ", body)                     # bold labels and finding titles
    body = re.sub(r"^\s*\|?\s*:?-{3}.*$", "", body, flags=re.M)            # table rules
    out: list[str] = []
    for m in re.finditer(r"(?<![\w.])(\d{1,4}(?:\.\d+)?)(?:\s*[-–]?\s*(port|year|gb|tb|mbps|gbps|volt|v|amp|ton|hp|cfm|ft|feet|inch|sq ?ft|%|users?|devices?|computers?|switch(?:es)?|units?))?\b", body, re.I):
        n = m.group(1)
        if "." in n or (m.start() > 0 and body[m.start() - 1] == "|" and int(n) < 10):
            continue
        if not _num_in(src, int(n), m.group(2) or ""):
            if not (m.group(2) and _num_in(src, int(n)) and m.group(2).lower().rstrip("s") in ("user", "device", "computer", "unit", "year")):
                out.append(m.group(0).strip())
    # Names: capitalised words that are not first in their sentence, cell or bullet.
    for chunk in re.split(r"(?:[.!?:;]\s+|\n|\|)", body):
        words = re.findall(r"[\w&+/-]+", chunk.strip(" *-•\t"))
        for i, w in enumerate(words):
            if i == 0 or not (w[0].isupper() or any(c.isdigit() for c in w)) or w.isdigit():
                continue
            lw = w.lower().strip("-/")
            if len(lw) > 1 and lw not in _COMMON and lw not in src:
                out.append(w)
    seen, uniq = set(), []
    for x in out:
        if x.lower() not in seen:
            seen.add(x.lower()); uniq.append(x)
    return uniq[:40]


def check_facts(draft: str, source: str) -> str:
    """Ask for the draft's unsupported details as exact quotes with fixes, and apply them."""
    import json
    transcript = source
    missing = _missing_details(draft, transcript)
    hint = ("\n\nWords and numbers from the draft that do not appear in the transcript letter for letter. Check these "
            "first; many will be fine (another spelling, a plain summary word, a heading). Fix only the ones that state "
            "something the transcript does not:\n- " + "\n- ".join(missing)) if missing else ""
    if missing:
        print(f"[Report] details not in the transcript: {missing}")
    raw = _clean(generate(CHECK_SYSTEM, f"SOURCE:\n\n{source}\n\n===== DRAFT REPORT =====\n\n{draft}{hint}", 3000))
    fixes = []
    for obj in re.findall(r"\{[^{}]*\}", raw):        # each object on its own, so a cut-off answer still counts
        try:
            fixes.append(json.loads(obj))
        except ValueError:
            continue
    applied = 0
    for f in fixes if isinstance(fixes, list) else []:
        q, fix = (f or {}).get("quote") or "", (f or {}).get("fix") or ""
        if not (len(q) >= 2 and q in draft and fix.strip() != q.strip() and not q.startswith("TITLE:")):
            continue
        if re.match(r"(?i)\s*(remove|delete|drop|omit|replace|change)\b", fix):
            continue                                   # an instruction, not text
        if len(q) <= 40 and fix and difflib.SequenceMatcher(None, re.sub(r"\W", "", q.lower()),
                                                           re.sub(r"\W", "", fix.lower())).ratio() > 0.7:
            continue                                   # a respelling, e.g. a name "corrected" to how it was mis-heard
        if "|" in q and q.count("|") != fix.count("|") and fix:
            continue                                   # would break a table row
        draft = draft.replace(q, fix.strip())
        applied += 1
    draft = re.sub(r"[ \t]{2,}", " ", draft)
    draft = re.sub(r"\b(\w+)( \1\b)+", r"\1", draft, flags=re.I)   # "Near Near" left where a fix met the text before it
    print(f"[Report] fact-check: {applied} of {len(fixes) if isinstance(fixes, list) else 0} corrections applied")
    return draft


def _clean(text: str | None) -> str:
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def _yaml(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _save_markdown(kind: str, title: str, body: str, sources: list[Path], prepared_for: str, prepared_by: str) -> Path:
    folder = _vault() / REPORTS_FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    base = f"{datetime.now():%Y-%m-%d} {_safe_name(title)}"
    p, n = folder / f"{base}.md", 2
    while p.exists() or p.with_suffix(".pdf").exists():
        p = folder / f"{base} ({n}).md"; n += 1
    front = ["---", "type: report", f"kind: {_yaml(kind)}", f"title: {_yaml(title)}", f"date: {datetime.now():%Y-%m-%d}"]
    if prepared_for:
        front.append(f"prepared_for: {_yaml(prepared_for)}")
    if prepared_by:
        front.append(f"prepared_by: {_yaml(prepared_by)}")
    front.append("sources:")
    front += [f"  - \"[[{s.stem}]]\"" for s in sources]
    front += ["tags: [report, delamain]", "---", ""]
    p.write_text("\n".join(front) + "\n" + body.rstrip() + "\n", encoding="utf-8")
    return p


def _frontmatter(text: str) -> tuple[dict, str]:
    m = re.match(r"\A---\n(.*?)\n---\n", text, flags=re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and not line.startswith(" "):
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] == '"':
                v = v[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            meta[k.strip()] = v
    return meta, text[m.end():]


CSS = """
@page { size: Letter; margin: 20mm 18mm 22mm;
  @bottom-left { content: "__TITLE__"; font: 8.5pt 'Helvetica Neue', Arial, sans-serif; color: #888; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8.5pt 'Helvetica Neue', Arial, sans-serif; color: #888; } }
@page :first { @bottom-left { content: none; } }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 'Source Serif 4', Georgia, 'Times New Roman', serif; color: #1d232a; margin: 0; }
.cover { border-bottom: 2.5px solid #0f5e74; padding-bottom: 10px; margin-bottom: 18px; }
.kind { font: 600 9pt 'Helvetica Neue', Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #0f5e74; }
.cover h1 { font: 700 21pt/1.2 'Helvetica Neue', Arial, sans-serif; margin: 4px 0 10px; color: #10181f; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; font: 9.5pt 'Helvetica Neue', Arial, sans-serif; color: #444; }
.meta b { color: #222; font-weight: 600; }
h2 { font: 700 13.5pt 'Helvetica Neue', Arial, sans-serif; color: #0f5e74; margin: 20px 0 6px; padding-bottom: 3px;
     border-bottom: 1px solid #d5dde2; break-after: avoid; }
h3 { font: 700 11pt 'Helvetica Neue', Arial, sans-serif; color: #10181f; margin: 14px 0 4px; break-after: avoid; }
h4 { font: 600 10.5pt 'Helvetica Neue', Arial, sans-serif; margin: 10px 0 3px; break-after: avoid; }
p { margin: 0 0 7px; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 8px; padding-left: 22px; } li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font: 9pt/1.35 'Helvetica Neue', Arial, sans-serif; break-inside: auto; }
thead { display: table-header-group; } tr { break-inside: avoid; }
th { background: #0f5e74; color: #fff; text-align: left; font-weight: 600; padding: 5px 7px; }
td { border-bottom: 1px solid #dfe5e9; padding: 5px 7px; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f5f8f9; }
em { color: #8a4b00; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #0f5e74; background: #f2f7f8; }
code { font: 9pt ui-monospace, Menlo, monospace; background: #f1f3f4; padding: 0 3px; }
hr { border: 0; border-top: 1px solid #d5dde2; margin: 14px 0; }
"""


def _chromium() -> str:
    for name in ("chromium", "google-chrome-stable", "google-chrome", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    raise RuntimeError("Chromium is needed to print the PDF and was not found")


def _css_string(s: str) -> str:
    """Text safe inside a CSS string (the page footer)."""
    s = s[:90]
    return "".join(ch if ch.isalnum() or ch in " .,-()&'" else f"\\{ord(ch):x} " for ch in s)


def render_pdf(md_path: Path) -> Path:
    """Print a report's Markdown to a PDF beside it."""
    meta, body = _frontmatter(md_path.read_text(encoding="utf-8", errors="replace"))
    title = meta.get("title") or md_path.stem
    rows = [("Date", meta.get("date", ""))]
    if meta.get("prepared_for"):
        rows.append(("Prepared for", meta["prepared_for"]))
    if meta.get("prepared_by"):
        rows.append(("Prepared by", meta["prepared_by"]))
    body = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", body)          # Obsidian links read as text
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body)
    md = MarkdownIt("commonmark", {"html": False}).enable("table").enable("strikethrough")
    page = (f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
            f"<style>{CSS.replace('__TITLE__', _css_string(title))}</style></head><body><div class='cover'>"
            f"<div class='kind'>{html.escape(meta.get('kind', 'Report'))}</div><h1>{html.escape(title)}</h1><div class='meta'>"
            + "".join(f"<b>{html.escape(k)}</b><span>{html.escape(v)}</span>" for k, v in rows if v)
            + f"</div></div>{md.render(body)}</body></html>")
    pdf = md_path.with_suffix(".pdf")
    with tempfile.TemporaryDirectory(prefix="delamain-pdf-") as tmp:
        src = Path(tmp) / "report.html"
        src.write_text(page, encoding="utf-8")
        out = Path(tmp) / "report.pdf"
        # A profile of its own, so it never attaches to a browser the passenger has open.
        subprocess.run([_chromium(), "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                        f"--user-data-dir={tmp}/profile", "--no-pdf-header-footer", f"--print-to-pdf={out}",
                        src.as_uri()], capture_output=True, timeout=120, check=False)
        if not out.exists() or out.stat().st_size < 1000:
            raise RuntimeError("Chromium did not produce the PDF")
        shutil.move(str(out), pdf)
    return pdf


def remake_report_pdf(report: str) -> str:
    """Print a report's Markdown (after editing it in Obsidian) to its PDF again."""
    p = _find_report(report)
    if not p:
        return "No report by that name in " + REPORTS_FOLDER + "."
    pdf = render_pdf(p)
    if notify:
        notify({"ok": True, "quiet": True, "title": p.stem, "pdf": _rel(pdf), "markdown": _rel(p)})
    return f"Printed {_rel(pdf)} again from {_rel(p)}."


def _find_report(report: str) -> Path | None:
    folder = _vault() / REPORTS_FOLDER
    if not folder.is_dir():
        return None
    mds = sorted(folder.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    want = (report or "").strip().lower().removesuffix(".md").removesuffix(".pdf")
    if want in ("", "latest", "last", "it", "that", "the last one"):
        return mds[0] if mds else None
    want = want.rsplit("/", 1)[-1]
    words = [w for w in re.findall(r"[\w'-]+", want) if len(w) > 2]
    for p in mds:
        if p.stem.lower() == want or (words and all(w in p.stem.lower() for w in words)):
            return p
    return None


def list_reports(limit: int = 40) -> list[dict]:
    folder = _vault() / REPORTS_FOLDER
    if not folder.is_dir():
        return []
    pdfs = sorted(folder.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    return [{"name": p.name, "title": p.stem, "modified": p.stat().st_mtime, "size": p.stat().st_size} for p in pdfs]


def report_file(name: str) -> Path | None:
    """The PDF of that file name in the reports folder, or None (no paths, nothing else)."""
    if not name or "/" in name or "\\" in name or name.startswith(".") or not name.lower().endswith(".pdf"):
        return None
    folder = (_vault() / REPORTS_FOLDER).resolve()
    p = (folder / name).resolve()
    return p if p.parent == folder and p.is_file() else None


def status() -> dict | None:
    return dict(_running) if _running else None
