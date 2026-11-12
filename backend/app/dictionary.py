"""JMdict and KANJIDIC2 lookup backed by a SQLite file built from the JSON in backend/data."""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from pathlib import Path

import wanakana

from . import analyzer

DATA = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA / "dict.sqlite"
SOURCES = ["dict-common.json", "dict-more-1.json", "dict-more-2.json", "dict-more-3.json", "kanji.json"]
SCHEMA_VERSION = "1"

_local = threading.local()
_build_lock = threading.Lock()
_pos: list[str] = []
_misc: list[str] = []

JLPT = {4: "N5", 3: "N4", 2: "N3–N2", 1: "N1"}
# Which dictionary parts of speech fit a word tapped in a text (keyed by the analyzer's word class).
CTX_POS = {"p": r"particle", "v": r"verb", "adj": r"adjective|pre-noun", "adv": r"adverb|conjunction|interjection",
           "aux": r"auxiliary|copula|particle", "n": r"noun|pronoun|counter|suffix|prefix|numeric"}


def _signature() -> str:
    return SCHEMA_VERSION + "|" + "|".join(f"{n}:{(DATA / n).stat().st_size}" for n in SOURCES)


def _needs_build() -> bool:
    if not DB_PATH.exists():
        return True
    try:
        con = sqlite3.connect(DB_PATH)
        row = con.execute("SELECT v FROM meta WHERE k='signature'").fetchone()
        con.close()
        return not row or row[0] != _signature()
    except sqlite3.Error:
        return True


def build(log=print) -> None:
    """Create dict.sqlite from the JSON sources. Takes a few seconds; runs once."""
    log("Building the dictionary database (first run only)…")
    tmp = DB_PATH.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript("""
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
        CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE entries(id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, senses TEXT, score INTEGER);
        CREATE TABLE forms(form TEXT, eid INTEGER);
        CREATE TABLE senses(eid INTEGER, si INTEGER, text TEXT);
        CREATE TABLE kanji(literal TEXT PRIMARY KEY, strokes INTEGER, grade INTEGER, jlpt INTEGER, onyomi TEXT, kunyomi TEXT, meaning TEXT);
    """)
    eid = 0
    for name in SOURCES[:4]:
        data = json.loads((DATA / name).read_text(encoding="utf-8"))
        if "pos" in data:
            con.execute("INSERT INTO meta VALUES('pos', ?)", (json.dumps(data["pos"], ensure_ascii=False),))
            con.execute("INSERT INTO meta VALUES('misc', ?)", (json.dumps(data["misc"], ensure_ascii=False),))
        entries, forms, senses = [], [], []
        for kanji, kana, ss, score in data["e"]:
            eid += 1
            entries.append((eid, kanji, kana, json.dumps(ss, ensure_ascii=False), score))
            for f in (kanji.split(";") if kanji else []) + kana.split(";"):
                forms.append((f, eid))
            for si, s in enumerate(ss):
                senses.append((eid, si, s[1].lower()))
        con.executemany("INSERT INTO entries VALUES(?,?,?,?,?)", entries)
        con.executemany("INSERT INTO forms VALUES(?,?)", forms)
        con.executemany("INSERT INTO senses VALUES(?,?,?)", senses)
    kanji = json.loads((DATA / "kanji.json").read_text(encoding="utf-8"))
    con.executemany("INSERT INTO kanji VALUES(?,?,?,?,?,?,?)", [(c, *v) for c, v in kanji.items()])
    con.execute("CREATE INDEX forms_form ON forms(form)")
    con.execute("CREATE INDEX senses_eid ON senses(eid)")
    con.execute("INSERT INTO meta VALUES('signature', ?)", (_signature(),))
    con.execute("INSERT INTO meta VALUES('count', ?)", (str(eid),))
    con.commit()
    con.close()
    tmp.replace(DB_PATH)
    log(f"Dictionary ready: {eid:,} entries.")


def ensure_built() -> None:
    with _build_lock:
        if _needs_build():
            build()
        global _pos, _misc
        if not _pos:
            con = sqlite3.connect(DB_PATH)
            _pos = json.loads(con.execute("SELECT v FROM meta WHERE k='pos'").fetchone()[0])
            _misc = json.loads(con.execute("SELECT v FROM meta WHERE k='misc'").fetchone()[0])
            con.close()


def _con() -> sqlite3.Connection:
    con = getattr(_local, "con", None)
    if con is None:
        ensure_built()
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        _local.con = con
    return con


def count() -> int:
    return int(_con().execute("SELECT v FROM meta WHERE k='count'").fetchone()[0])


def kanji_levels() -> dict[str, int]:
    """literal -> old-style JLPT level (4 = N5 … 1 = N1); kanji without a level are left out."""
    return {c: j for c, j in _con().execute("SELECT literal, jlpt FROM kanji WHERE jlpt > 0")}


def _grade_text(g: int) -> str:
    if 1 <= g <= 6:
        return f"taught in grade {g}"
    if g == 8:
        return "taught in secondary school"
    return "used in names" if g >= 9 else "not a school kanji"


def kanji_info(chars: str) -> list[dict]:
    out, seen = [], set()
    for c in chars:
        if c in seen:
            continue
        seen.add(c)
        row = _con().execute("SELECT literal, strokes, grade, jlpt, onyomi, kunyomi, meaning FROM kanji WHERE literal=?", (c,)).fetchone()
        if row:
            out.append({"literal": row[0], "strokes": row[1], "grade": _grade_text(row[2]), "jlpt": JLPT.get(row[3], ""),
                        "on": row[4], "kun": row[5], "meaning": row[6]})
    return out


def _entry(row) -> dict:
    eid, kanji, kana, senses_json, score = row
    K = kanji.split(";") if kanji else []
    R = kana.split(";")
    senses = []
    for s in json.loads(senses_json):
        senses.append({"pos": [_pos[i] for i in s[0]], "gloss": s[1],
                       "misc": [_misc[i] for i in (s[2] if len(s) > 2 else [])],
                       "note": s[3] if len(s) > 3 else ""})
    return {"id": eid, "kanji": K, "kana": R, "common": score >= 50, "score": score, "senses": senses,
            "head": analyzer.align(K[0], analyzer.to_hira(R[0])) if K else [[R[0], None]],
            "kanjiInfo": kanji_info(K[0]) if K else []}


def _entries_by_id(ids: list[int]) -> list[dict]:
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    rows = {r[0]: r for r in _con().execute(f"SELECT id, kanji, kana, senses, score FROM entries WHERE id IN ({marks})", ids)}
    return [_entry(rows[i]) for i in ids if i in rows]


def _ctx_score(e: dict, cls: str, base: str) -> int:
    if not cls:
        return 0
    sc = 0
    pattern = CTX_POS.get(cls)
    if pattern and any(re.search(pattern, p) for s in e["senses"] for p in s["pos"]):
        sc += 400
    if not analyzer.has_kanji(base) and e["kanji"] and not any("usually kana" in s["misc"] for s in e["senses"]):
        sc -= 150
    return sc


def exact_entries(form: str, cls: str = "", limit: int = 40) -> list[dict]:
    ids = [r[0] for r in _con().execute(
        "SELECT DISTINCT e.id FROM forms f JOIN entries e ON e.id=f.eid WHERE f.form=? ORDER BY e.score DESC LIMIT 200", (form,))]
    entries = _entries_by_id(ids)
    entries.sort(key=lambda e: -(e["score"] + _ctx_score(e, cls, form)))
    return entries[:limit]


def search_jp(q: str, limit: int = 40) -> list[tuple[int, int, bool]]:
    """Return (rank score, entry id, is exact match), best first."""
    variants = list(dict.fromkeys([q, analyzer.to_hira(q), analyzer.to_kata(q)]))
    best: dict[int, tuple[int, int]] = {}
    for s in variants:
        for form, eid, score in _con().execute(
                "SELECT f.form, f.eid, e.score FROM forms f JOIN entries e ON e.id=f.eid WHERE instr(f.form, ?) > 0", (s,)):
            if form == s:
                sc = 1000
            elif form.startswith(s):
                sc = 600 - (len(form) - len(s)) * 8
            else:
                sc = 300 - (len(form) - len(s)) * 8
            if sc > 0 and sc > best.get(eid, (0, 0))[0]:
                best[eid] = (sc, score)
    ranked = sorted(((sc + score, eid, sc >= 1000) for eid, (sc, score) in best.items()), reverse=True)
    return ranked[:limit]


def search_en(q: str, limit: int = 40) -> list[tuple[int, int, bool]]:
    ql = q.lower().strip()
    word = re.compile(r"(^|[^a-z])" + re.escape(ql) + r"($|[^a-z])")
    paren = re.compile(r"\s*\([^)]*\)\s*")
    best: dict[int, tuple[int, int, bool]] = {}
    rows = _con().execute(
        "SELECT s.eid, s.si, s.text, e.score FROM senses s JOIN entries e ON e.id=s.eid "
        "WHERE instr(s.text, ?) > 0 ORDER BY e.score DESC LIMIT 8000", (ql,))
    for eid, si, text, score in rows:
        top, exact = 0, False
        for pi, part in enumerate(text.split("; ")):
            core = paren.sub(" ", part).strip()
            if core in (ql, "to " + ql, "to be " + ql):
                sc = 900 - pi * 30
            elif word.search(part):
                starts = core.startswith(ql + " ") or core.startswith("to " + ql + " ")
                sc = (480 if starts else 340) - pi * 15 - min(len(core), 60)
            else:
                continue
            sc -= si * 50
            if sc > top:
                top, exact = sc, sc > 600
        if top > 0 and top > best.get(eid, (0, 0, False))[0]:
            best[eid] = (top, score, exact)
    ranked = sorted(((sc + score * 2, eid, exact) for eid, (sc, score, exact) in best.items()), reverse=True)
    return ranked[:limit]


def search(q: str, direction: str = "auto", cls: str = "", base: str = "") -> dict:
    """Search in either direction. `cls`/`base` describe a word tapped in a text, to order homographs sensibly."""
    q = q.strip()
    groups: list[dict] = []
    if not q:
        return {"groups": groups, "total": 0}
    from_text = bool(cls) and base == q
    if analyzer.JP_RE.search(q):
        res = search_jp(q)
        any_exact = any(r[2] for r in res)
        if not any_exact:
            ws = analyzer.words(q)
            if len(ws) == 1 and ws[0]["base"] != q:
                ex = exact_entries(ws[0]["base"], limit=8)
                if ex:
                    groups.append({"title": f"Dictionary form: {ws[0]['base']}", "word": ws[0], "entries": ex})
            elif len(ws) > 1:
                seen, found = set(), []
                for w in ws:
                    ex = exact_entries(w["base"], w["cls"], limit=1)
                    if ex and ex[0]["id"] not in seen:
                        seen.add(ex[0]["id"])
                        found.append(ex[0])
                if found:
                    groups.append({"title": "Word by word", "entries": found})
        if from_text and any_exact:
            ex = exact_entries(q, cls)
            have = {e["id"] for e in ex}
            rest = _entries_by_id([eid for _, eid, _ in res if eid not in have])
            groups.append({"title": "", "entries": (ex + rest)[:40]})
        elif res:
            groups.append({"title": f"Entries containing {q}" if groups else "", "entries": _entries_by_id([r[1] for r in res])})
    else:
        kana = wanakana.to_hiragana(q.lower())
        valid_kana = bool(re.fullmatch("[ぁ-ゖー]+", kana))
        jp = en = []
        if direction != "ej" and valid_kana:
            jp = [r for r in search_jp(kana) if direction == "je" or r[0] >= 560]
        if direction != "je":
            en = search_en(q)
        gj = {"title": f"Japanese words read “{kana}”", "entries": _entries_by_id([r[1] for r in jp])}
        ge = {"title": f"Japanese for “{q}”", "entries": _entries_by_id([r[1] for r in en])}
        en_first = direction == "ej" or (en and en[0][2]) or not any(r[2] for r in jp)
        groups.extend(g for g in ([ge, gj] if en_first else [gj, ge]) if g["entries"])
    return {"groups": groups, "total": sum(len(g["entries"]) for g in groups)}
