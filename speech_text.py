"""Turn a written reply into text the voice model can say.

F5-TTS reads characters, not meaning: it has never learned how to say "#611", "34°F",
"write_note" or "18414", so it guesses, and characters missing from its vocabulary
(curly quotes and apostrophes among them) are read as a space, which splits words
("I’m" becomes "I m"). Everything here runs just before synthesis; the text shown on
screen is unchanged.
"""
from __future__ import annotations

import re

_ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
         "fifteen sixteen seventeen eighteen nineteen").split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_SCALES = ((10 ** 12, "trillion"), (10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand"))
_ORDINAL = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
            "nine": "ninth", "twelve": "twelfth"}


def _under_100(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")


def _under_1000(n: int) -> str:
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        parts.append(f"{_ONES[hundreds]} hundred")
    if rest:
        parts.append(_under_100(rest))
    return " ".join(parts)


def number_words(n: int) -> str:
    if n < 0:
        return "minus " + number_words(-n)
    if n < 1000:
        return _under_1000(n) if n else "zero"
    for size, name in _SCALES:
        if n >= size:
            high, rest = divmod(n, size)
            return f"{number_words(high)} {name}" + (f" {number_words(rest)}" if rest else "")
    return str(n)


def year_words(n: int) -> str:
    """1999 -> nineteen ninety-nine, 2026 -> twenty twenty-six, 2005 -> two thousand five."""
    high, low = divmod(n, 100)
    if 2000 <= n <= 2009:
        return number_words(n)
    if low == 0:
        return f"{_under_100(high)} hundred"
    return f"{_under_100(high)} {'oh ' + _ONES[low] if low < 10 else _under_100(low)}"


def ordinal_words(n: int) -> str:
    words = number_words(n)
    head, _, last = words.rpartition(" ")
    if "-" in last:
        a, b = last.rsplit("-", 1)
        last = f"{a}-{_ordinal_word(b)}"
    else:
        last = _ordinal_word(last)
    return f"{head} {last}".strip()


def _ordinal_word(w: str) -> str:
    if w in _ORDINAL:
        return _ORDINAL[w]
    if w.endswith("y"):
        return w[:-1] + "ieth"
    return w + "th"


def digits_words(s: str) -> str:
    return " ".join(_ONES[int(c)] for c in s if c.isdigit())


def _decimal(m: re.Match) -> str:
    whole, frac = m.group(1).replace(",", ""), m.group(2)
    return f"{number_words(int(whole))} point {digits_words(frac)}"


def _plain_number(m: re.Match) -> str:
    raw = m.group(0)
    s = raw.replace(",", "")
    n = int(s)
    if "," not in raw and len(s) == 4 and 1100 <= n <= 2099:
        return year_words(n)
    if len(s) > 1 and s.startswith("0"):
        return digits_words(s)          # 007, zip-style codes
    if "," not in raw and len(s) >= 5:
        # House numbers and other long ids are read in pairs: 18414 -> eighteen four fourteen.
        pairs = [s[:2], s[2], s[3:]] if len(s) == 5 else [s[i:i + 2] for i in range(0, len(s), 2)]
        return " ".join(digits_words(p) if p.startswith("0") and len(p) == 2 else number_words(int(p)) for p in pairs)
    return number_words(n)


_UNITS = [
    (r"°\s*F\b", " degrees Fahrenheit"), (r"°\s*C\b", " degrees Celsius"), (r"°", " degrees"),
    (r"(?<=\d)\s*mph\b", " miles per hour"), (r"(?<=\d)\s*km/h\b", " kilometres per hour"),
    (r"(?<=\d)\s*km\b", " kilometres"), (r"(?<=\d)\s*mi\b", " miles"), (r"(?<=\d)\s*ft\b", " feet"),
    (r"(?<=\d)\s*lbs?\b", " pounds"), (r"(?<=\d)\s*kg\b", " kilograms"), (r"(?<=\d)\s*GB\b", " gigabytes"),
    (r"(?<=\d)\s*MB\b", " megabytes"), (r"(?<=\d)\s*ms\b", " milliseconds"), (r"(?<=\d)\s*%", " percent"),
]
_ABBREV = [
    (r"\bDr\.(?=\s+[A-Z])", "Doctor"), (r"\bMr\.", "Mister"), (r"\bMrs\.", "Missus"), (r"\bMs\.", "Miz"),
    (r"\bSt\.(?=\s+[A-Z])", "Saint"), (r"\be\.g\.", "for example"), (r"\bi\.e\.", "that is"),
    (r"\betc\.", "et cetera"), (r"\bvs\.?(?=\s)", "versus"), (r"\bapprox\.", "approximately"),
    (r"\bAM\b", "A M"), (r"\bPM\b", "P M"), (r"\ba\.m\.", "A M"), (r"\bp\.m\.", "P M"),
]
_CHARS = str.maketrans({"’": "'", "‘": "'", "‛": "'", "ʼ": "'", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
                        " ": " ", " ": " ", " ": " ", "​": "", "…": "...", "‑": "-", "−": "-"})


def speakable(text: str) -> str:
    t = text.translate(_CHARS)
    # Markdown and links: say the words, not the markup.
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"https?://\S+", "a link", t)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"(\*\*|__|\*|~~)(?=\S)(.+?)(?<=\S)\1", r"\2", t)
    t = re.sub(r"^\s*(#{1,6}|[-*•]|\d+\.)\s+", "", t, flags=re.M)
    t = re.sub(r"[\U0001F000-\U0001FAFF☀-➿]", "", t)   # emoji and pictographs
    # Identifiers: write_note -> write note, camelCase -> camel case.
    t = re.sub(r"(?<=[A-Za-z])_(?=[A-Za-z0-9])", " ", t)
    t = re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", " ", t)
    for pat, rep in _ABBREV:
        t = re.sub(pat, rep, t)
    # Numbers with meaning attached, before plain numbers.
    t = re.sub(r"\$(\d[\d,]*)\.(\d\d)\b", lambda m: f"{number_words(int(m.group(1).replace(',', '')))} dollars and {number_words(int(m.group(2)))} cents", t)
    t = re.sub(r"\$(\d[\d,]*)\b", lambda m: f"{number_words(int(m.group(1).replace(',', '')))} dollars", t)
    t = re.sub(r"#\s?(\d+)", lambda m: "number " + number_words(int(m.group(1))), t)
    t = re.sub(r"\b(\d{1,2}):(\d\d)\b", lambda m: number_words(int(m.group(1))) + ("" if m.group(2) == "00" else " " + ("oh " + _ONES[int(m.group(2))] if m.group(2).startswith("0") else number_words(int(m.group(2))))), t)
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: ordinal_words(int(m.group(1))), t)
    for pat, rep in _UNITS:
        t = re.sub(pat, rep, t)
    for frac, words in (("1/2", "one half"), ("1/3", "one third"), ("2/3", "two thirds"), ("1/4", "one quarter"), ("3/4", "three quarters")):
        t = re.sub(rf"(?<![\d/]){re.escape(frac)}(?![\d/])", words, t)
    t = re.sub(r"(?<!\d)(\d+)\s*/\s*(\d+)(?!\d)", lambda m: f"{number_words(int(m.group(1)))} out of {number_words(int(m.group(2)))}", t)
    t = re.sub(r"(?<![\w.])-(\d)", r"minus \1", t)
    t = re.sub(r"\b(\d[\d,]*)\.(\d+)\b", _decimal, t)
    t = re.sub(r"\b\d{1,3}(?:,\d{3})+\b|\b\d+\b", _plain_number, t)
    # Symbols that are left.
    t = t.replace("&", " and ").replace("+", " plus ").replace("=", " equals ").replace("@", " at ")
    t = re.sub(r"\s*[—–]\s*", ", ", t)                  # dashes become a short pause
    t = re.sub(r"(?<=\w)/(?=\w)", " or ", t)
    t = re.sub(r"[#*_~^|<>{}\[\]\\]", " ", t)
    t = re.sub(r"\s*\.\.\.\s*", "... ", t)
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    t = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip()
