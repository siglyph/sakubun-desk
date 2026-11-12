"""Grammar reference: search, lookup and spotting patterns in a sentence."""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import analyzer

DATA = Path(__file__).resolve().parent.parent / "data" / "grammar.json"

CATEGORIES = {
    "particles": "Particles", "basics": "Basic sentences", "verb-forms": "Verb forms", "adjectives": "Adjectives",
    "tense-aspect": "Ongoing, finished, prepared (aspect)", "listing": "Listing: and / or", "reason": "Reasons and causes",
    "purpose": "Purpose: in order to", "condition": "If / when (conditions)", "contrast": "But / although",
    "time": "Time: when, before, after, while", "comparison": "Comparing and degree", "desire": "Wants, plans, decisions",
    "request": "Requests, invitations, advice", "permission": "Permission and prohibition",
    "obligation": "Must / should / supposed to", "ability": "Can / easy / hard to", "giving": "Giving and receiving",
    "quotation": "Quoting, hearsay, embedded questions", "conjecture": "Seems / probably / might",
    "voice": "Passive and causative", "keigo": "Honorific and humble speech", "nominalization": "Turning clauses into nouns",
    "change": "Change and experience", "emphasis": "Only / even / emphasis", "discourse": "Connecting sentences",
    "expression": "Set expressions",
}
SOURCE_ORDER = {"Genki I": 0, "Genki II": 1, "Tobira": 2}
STOP = set("i you he she it we they a an the to do does did is am are was were be x y z and of in on at my me this that how what say want".split())

_NORM_RE = re.compile(r"[A-Za-z0-9\s〜~～・…。、，,()（）「」＋+\-ー/／]")
_SPLIT_RE = re.compile(r"\s+[/／]\s+")   # " / " separates variants; a bare slash is part of one pattern

ENTRIES: list[dict] = []
BY_ID: dict[str, dict] = {}


def norm(s: str) -> str:
    return _NORM_RE.sub("", s or "")


def _tag(g: dict) -> str:
    unit = "Ch" if g["source"] == "Tobira" else "L"
    return f"{g['source']} · {unit}{g['lesson']}"


def load() -> None:
    if ENTRIES:
        return
    entries = json.loads(DATA.read_text(encoding="utf-8"))
    entries.sort(key=lambda g: (SOURCE_ORDER.get(g["source"], 9), g["lesson"]))
    for g in entries:
        variants = _SPLIT_RE.split(g["pattern"])
        g["_keys"] = [k for k in (norm(p) for p in variants) if k]
        # For matching a pattern name, also accept each side of an inline alternation (ならない/いけない).
        pieces = [norm(piece) for v in variants if "/" in v or "／" in v for piece in re.split("[/／]", v)]
        g["_find"] = g["_keys"] + [k for k in pieces if len(k) >= 3]
        g["_re"] = []
        for m in g.get("match", []):
            try:
                g["_re"].append(re.compile(m))
            except re.error:
                pass  # written for JavaScript; skip the rare pattern Python cannot compile
        g["_kw"] = [k.lower() for k in g.get("keywords", [])]
        g["_text"] = (g["meaning"] + " " + g["explanation"]).lower()
        g["_tag"] = _tag(g)
        BY_ID[g["id"]] = g
    ENTRIES.extend(entries)


def brief(g: dict) -> dict:
    return {"id": g["id"], "pattern": g["pattern"], "short": _SPLIT_RE.split(g["pattern"])[0], "meaning": g["meaning"],
            "tag": g["_tag"], "source": g["source"], "lesson": g["lesson"], "category": g["category"]}


def meta() -> dict:
    load()
    lessons: dict[str, list[int]] = {}
    for g in ENTRIES:
        lessons.setdefault(g["source"], [])
        if g["lesson"] not in lessons[g["source"]]:
            lessons[g["source"]].append(g["lesson"])
    used = {g["category"] for g in ENTRIES}
    return {"count": len(ENTRIES), "sources": list(lessons), "lessons": {s: sorted(v) for s, v in lessons.items()},
            "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items() if k in used]}


def find(name: str) -> dict | None:
    """Match a pattern name (from Claude, or a "compare with" link) to a reference entry."""
    load()
    n = norm(name)
    if not n:
        return None
    best, best_score = None, 0.0
    for g in ENTRIES:
        for k in g["_find"]:
            if k == n:
                sc = 100.0
            elif len(n) >= 2 and len(k) >= 2 and (n in k or k in n):
                # a name that is a shortened headline beats a headline that merely appears inside the name
                sc = 60 * min(len(k), len(n)) / max(len(k), len(n)) + (10 if n in k else 0)
            else:
                continue
            if sc > best_score:
                best, best_score = g, sc
    if best_score >= 40:
        return best
    # A conjugated name (〜ようにしている) will not equal the headline (〜ようにする): fall back to the
    # entry whose detection pattern covers most of the name.
    plain = re.sub(r"[〜~～\s]", "", name)
    cover, hit = 0.0, None
    for g in ENTRIES:
        for rx in g["_re"]:
            m = rx.search(plain)
            if m and len(m.group(0)) / len(plain) > cover:
                cover, hit = len(m.group(0)) / len(plain), g
    return hit if cover >= 0.6 else None


def for_word(base: str, surface: str) -> list[dict]:
    """Reference entries whose headline is exactly this word (mostly particles)."""
    load()
    keys = {base, surface}
    out, seen = [], set()
    for g in ENTRIES:
        if any(k in keys for k in g["_keys"]) and g["_keys"][0] not in seen:
            seen.add(g["_keys"][0])
            out.append(brief(g))
    return out[:6]


def detect(text: str) -> list[dict]:
    """Spot reference patterns in a sentence by regex. Rarer structures win the limited space."""
    load()
    hits, seen = [], set()
    for g in ENTRIES:
        for rx in g["_re"]:
            m = rx.search(text)
            if m and m.group(0):
                key, span = g["_keys"][0] if g["_keys"] else g["id"], f"{m.start()}:{m.group(0)}"
                if key not in seen and span not in seen:
                    seen.update((key, span))
                    hits.append((g.get("f", 0), m.start(), g))
                break
    hits = sorted(hits, key=lambda h: h[0])[:8]
    return [g for _, _, g in sorted(hits, key=lambda h: h[1])]


def _word_re(w: str) -> re.Pattern:
    return re.compile(r"(^|[^a-z])" + re.escape(w) + r"($|[^a-z])")


def _score(g: dict, q: str) -> float:
    ql = q.lower().strip()
    sc = 0.0
    if analyzer.JP_RE.search(q):
        n = norm(q)
        for k in g["_keys"]:
            if k == n:
                sc += 20
            elif n and n in k:
                sc += 10 - min(6, len(k) - len(n))
        if not sc and len(n) >= 4 and any(rx.search(q) for rx in g["_re"]):
            sc += 6
        if not sc and n and any(q in ex["ja"] for ex in g["examples"]):
            sc += 1
        return sc
    rom = g["romaji"].lower()
    if rom == ql:
        sc += 18
    elif len(ql) >= 2 and ql in re.split(r"[\s/]+", rom):
        sc += 12
    elif len(ql) >= 3 and ql in rom:
        sc += 6
    for kw in g["_kw"]:
        if kw == ql:
            sc += 14
        elif len(kw) >= 2 and _word_re(kw).search(ql):
            sc += 4 + min(len(kw), 12) * 0.3
        elif len(ql) >= 3 and ql in kw:
            sc += 4
    meaning = g["meaning"].lower()
    for t in re.split(r"[^a-z'-]+", ql):
        if len(t) <= 1 or t in STOP:
            continue
        rx = _word_re(t)
        if rx.search(meaning):
            sc += 3
        elif rx.search(g["_text"]):
            sc += 0.6
        if t in g["id"]:
            sc += 1
    return sc


def search(q: str = "", source: str = "", lesson: int | None = None, category: str = "") -> list[dict]:
    load()
    pool = [g for g in ENTRIES if (not source or g["source"] == source) and (lesson is None or g["lesson"] == lesson)
            and (not category or g["category"] == category)]
    q = q.strip()
    if q:
        scored = [(s, i, g) for i, g in enumerate(pool) if (s := _score(g, q)) > 0]
        pool = [g for _, _, g in sorted(scored, key=lambda x: (-x[0], x[1]))[:60]]
    return [brief(g) for g in pool]


def detail(gid: str) -> dict | None:
    load()
    g = BY_ID.get(gid)
    if not g:
        return None
    see = []
    for p in g.get("seeAlso", []):
        target = find(p)
        see.append({"pattern": p, "entry": brief(target) if target and target is not g else None})
    unit = "Chapter" if g["source"] == "Tobira" else "Lesson"
    return {**brief(g), "where": f"{g['source']} · {unit} {g['lesson']}", "categoryLabel": CATEGORIES.get(g["category"], ""),
            "formation": g["formation"], "explanation": g["explanation"],
            "examples": [{"ja": ex["ja"], "en": ex["en"], "items": analyzer.analyze(ex["ja"])} for ex in g["examples"]],
            "seeAlso": see}


def index_lines() -> str:
    """Compact id | pattern | meaning listing, sent to Claude when it picks entries."""
    load()
    return "\n".join(f"{g['id']} | {g['pattern']} | {g['meaning']}" for g in ENTRIES)
