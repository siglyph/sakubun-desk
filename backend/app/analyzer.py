"""Tokenize Japanese text into learner-sized words with readings and inflection notes.

Janome (IPA dictionary) splits a conjugated verb into several tokens (食べ / まし / た).
This module glues those back into one word, works out which kana belong over which
kanji, and describes the conjugation chain in plain English.
"""
from __future__ import annotations

import re
import threading

from janome.tokenizer import Tokenizer

_KANJI = "㐀-䶿一-鿿豈-﫿々〆ヶヵ"
KANJI_RE = re.compile(f"[{_KANJI}]")
_RUNS_RE = re.compile(f"[{_KANJI}]+|[^{_KANJI}]+")
JP_RE = re.compile("[぀-ヿ㐀-鿿]")
_SENTENCE_RE = re.compile(r"[^。！？!?\n]+[。！？!?]*[」』）)]*")

_tokenizer: Tokenizer | None = None
_lock = threading.Lock()


def _tok() -> Tokenizer:
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = Tokenizer()
    return _tokenizer


def has_kanji(s: str) -> bool:
    return bool(KANJI_RE.search(s))


def to_hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def to_kata(s: str) -> str:
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


def align(surface: str, reading: str) -> list[list[str | None]]:
    """Split a word into [text, reading-or-None] pieces so kana sit only over kanji."""
    if not reading or not has_kanji(surface):
        return [[surface, None]]
    runs = _RUNS_RE.findall(surface)
    is_k = [bool(KANJI_RE.match(r)) for r in runs]
    pattern = "^" + "".join("(.+?)" if k else f"({re.escape(to_hira(r))})" for r, k in zip(runs, is_k)) + "$"
    m = re.match(pattern, reading)
    if not m:
        return [[surface, reading]]
    return [[r, m.group(i + 1) if k else None] for i, (r, k) in enumerate(zip(runs, is_k))]


# The IPA dictionary's default reading for these is not the one a learner expects.
READING_FIX = {"日本": "ニホン", "日本人": "ニホンジン", "私": "ワタシ", "明日": "アシタ", "何": "ナニ"}

INFLECTING = {"動詞", "形容詞", "助動詞"}
NO_MERGE_AUX = {"です", "だ", "らしい", "べし", "まい", "ごとし"}
MERGE_PARTICLES = {"て", "で", "ば", "たり", "だり"}

POS_LABEL = {
    "名詞": {"": "noun", "代名詞": "pronoun", "固有名詞": "proper noun", "数": "number", "形容動詞語幹": "na-adjective",
           "サ変接続": "noun (takes する)", "接尾": "suffix / counter", "非自立": "dependent noun", "副詞可能": "noun (also adverbial)"},
    "動詞": {"": "verb", "非自立": "helper verb", "接尾": "verb ending"},
    "形容詞": {"": "i-adjective"},
    "副詞": {"": "adverb"},
    "助動詞": {"": "auxiliary"},
    "連体詞": {"": "pre-noun word"},
    "接続詞": {"": "conjunction"},
    "感動詞": {"": "interjection"},
    "接頭詞": {"": "prefix"},
    "フィラー": {"": "filler"},
    "助詞": {"": "particle", "格助詞": "case particle", "係助詞": "topic / focus particle", "接続助詞": "conjunctive particle",
           "終助詞": "sentence-ending particle", "副助詞": "adverbial particle", "並立助詞": "listing particle",
           "連体化": "linking particle (の)", "副詞化": "adverb-forming particle"},
}
POS_CLASS = {"名詞": "n", "動詞": "v", "形容詞": "adj", "副詞": "adv", "助詞": "p", "助動詞": "aux",
             "連体詞": "adj", "接続詞": "adv", "感動詞": "adv", "接頭詞": "n"}
AUX_LABEL = {
    "ます": "polite", "た": "past", "ない": "negative", "ぬ": "negative", "ん": "negative", "たい": "want to",
    "たがる": "seems to want to", "れる": "passive / honorific", "られる": "passive / potential / honorific",
    "せる": "causative", "させる": "causative", "う": "volitional", "よう": "volitional", "て": "て-form", "で": "て-form",
    "ば": "ば conditional", "たり": "たり form", "だり": "たり form", "です": "polite copula", "だ": "copula", "がる": "shows signs of",
}
FORM_LABEL = {
    "連用形": "stem (ます-stem)", "連用タ接続": "stem used before て / た", "連用テ接続": "く form", "未然形": "ない-stem",
    "未然ウ接続": "volitional stem", "仮定形": "ば-stem", "命令ｒｏ": "command form", "命令ｙｏ": "command form",
    "命令ｅ": "command form", "命令ｉ": "command form", "体言接続": "noun-modifying form", "ガル接続": "stem",
    "仮定縮約１": "contracted conditional", "未然レル接続": "ない-stem", "未然ヌ接続": "ない-stem",
}


def _type_label(t: str) -> str:
    if not t or t == "*":
        return ""
    for prefix, label in (("一段", "ichidan (ru-verb)"), ("五段", "godan (u-verb)"), ("サ変", "irregular する"),
                          ("カ変", "irregular 来る"), ("形容詞", "i-adjective")):
        if t.startswith(prefix):
            return label
    return ""


class _T:
    """One dictionary token, with the part-of-speech string already split."""
    __slots__ = ("surface", "pos", "detail", "infl_type", "infl_form", "base", "reading")

    def __init__(self, tok):
        parts = tok.part_of_speech.split(",")
        self.surface = tok.surface
        self.pos = parts[0]
        self.detail = parts[1] if len(parts) > 1 else "*"
        self.infl_type = tok.infl_type
        self.infl_form = tok.infl_form
        self.base = tok.base_form
        self.reading = tok.reading


def _can_join(group: list[_T], t: _T) -> bool:
    last = group[-1]
    if last.pos not in INFLECTING:
        return False
    if t.pos == "助動詞":
        return t.base not in NO_MERGE_AUX
    if t.pos == "助詞":
        return t.detail in ("接続助詞", "並立助詞") and t.base in MERGE_PARTICLES and last.infl_form != "基本形"
    return t.pos == "動詞" and t.detail == "接尾"


def _word(tokens: list[_T], start: int) -> dict:
    head = tokens[0]
    surface = "".join(t.surface for t in tokens)
    base = head.base if head.base and head.base != "*" else head.surface
    cls = "adj" if head.pos == "名詞" and head.detail == "形容動詞語幹" else POS_CLASS.get(head.pos, "")
    labels = POS_LABEL.get(head.pos, {})
    parts: list[list[str | None]] = []
    reading = ""
    for t in tokens:
        raw = READING_FIX[t.surface] if t.surface in READING_FIX and t.pos == "名詞" else t.reading
        r = to_hira(raw) if raw and raw != "*" else ("" if has_kanji(t.surface) else to_hira(t.surface))
        reading += r
        parts.extend(align(t.surface, r))
    steps: list = []
    vtype = ""
    if head.pos in INFLECTING and (len(tokens) > 1 or (head.infl_form not in ("", "*", "基本形"))):
        vtype = _type_label(head.infl_type)
        if len(tokens) == 1 and head.infl_form in FORM_LABEL:
            steps.append(FORM_LABEL[head.infl_form])
        for t in tokens[1:]:
            steps.append({"jp": t.surface, "label": AUX_LABEL.get(t.base, "")})
    return {"t": "w", "s": surface, "start": start, "end": start + len(surface), "base": base, "cls": cls,
            "label": labels.get(head.detail) or labels.get("", ""), "reading": reading, "parts": parts,
            "steps": steps, "vtype": vtype}


def analyze(text: str) -> list[dict]:
    """Return the text as a list of items: words ("w"), punctuation ("p") and newlines ("n")."""
    items: list[dict] = []
    line_start = 0
    for li, line in enumerate(text.split("\n")):
        if li > 0:
            items.append({"t": "n", "s": "\n", "start": line_start - 1, "end": line_start})
        if line:
            with _lock:
                toks = [_T(t) for t in _tok().tokenize(line)]
            pos = 0
            group: list[_T] = []
            group_start = 0

            def flush():
                if group:
                    items.append(_word(list(group), group_start))
                    group.clear()

            for t in toks:
                at = line.find(t.surface, pos)
                if at < 0:
                    at = pos
                pos = at + len(t.surface)
                start = line_start + at
                if t.pos == "記号" or not t.surface.strip():
                    flush()
                    items.append({"t": "p", "s": t.surface, "start": start, "end": start + len(t.surface)})
                    continue
                if group and _can_join(group, t):
                    group.append(t)
                else:
                    flush()
                    group.append(t)
                    group_start = start
            flush()
        line_start += len(line) + 1
    return items


def words(text: str) -> list[dict]:
    return [i for i in analyze(text) if i["t"] == "w"]


def split_sentences(text: str) -> list[dict]:
    out = []
    for m in _SENTENCE_RE.finditer(text):
        raw = m.group(0)
        t = raw.strip()
        if t:
            out.append({"text": t, "start": m.start() + (len(raw) - len(raw.lstrip()))})
    return out
