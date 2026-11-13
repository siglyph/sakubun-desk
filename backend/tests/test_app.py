"""Run from backend/:  pytest"""
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ai, analyzer, dictionary, grammar
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_conjugated_verb_is_one_word():
    ws = analyzer.words("映画を見に行きました。")
    last = ws[-1]
    assert last["s"] == "行きました" and last["base"] == "行く"
    assert [s["label"] for s in last["steps"]] == ["polite", "past"]


def test_readings_sit_over_kanji_only():
    w = analyzer.words("食べました")[0]
    assert w["parts"][0] == ["食", "た"] and w["parts"][1][1] is None
    assert analyzer.align("お兄さん", "おにいさん") == [["お", None], ["兄", "にい"], ["さん", None]]


def test_offsets_cover_newlines():
    text = "今日は。\n明日も。"
    for item in analyzer.analyze(text):
        assert text[item["start"]:item["end"]] == item["s"]


def test_dictionary_both_directions(client):
    def heads(q, **kw):
        r = client.get("/api/dict/search", params={"q": q, **kw}).json()
        return [(g["title"], [(e["kanji"] or e["kana"])[0] for e in g["entries"][:5]]) for g in r["groups"]]

    assert "食べる" in heads("eat")[0][1]
    assert heads("taberu")[0][1][0] == "食べる"
    assert heads("食べました")[0] == ("Dictionary form: 食べる", ["食べる"])
    assert heads("猫")[0][1][0] == "猫"


def test_tapped_particle_prefers_the_particle_entry(client):
    r = client.get("/api/dict/search", params={"q": "で", "cls": "p", "base": "で"}).json()
    assert "particle" in r["groups"][0]["entries"][0]["senses"][0]["pos"]


def test_every_grammar_pattern_matches_its_own_examples():
    grammar.load()
    data = json.loads(Path(grammar.DATA).read_text(encoding="utf-8"))
    for g in data:
        patterns = [re.compile(m) for m in g.get("match", [])]      # must compile in Python too
        for ex in g["examples"] if patterns else []:
            assert any(p.search(ex["ja"]) for p in patterns), (g["id"], ex["ja"])


def test_grammar_search_and_detail(client):
    items = client.get("/api/grammar", params={"q": "tari"}).json()["items"]
    assert items[0]["id"] == "g1-l11-tari-tari"
    assert any(i["id"] == "g1-l11-tari-tari" for i in client.get("/api/grammar", params={"q": "I do X or Y"}).json()["items"][:6])
    d = client.get("/api/grammar/entry/g1-l11-tari-tari").json()
    assert d["examples"][0]["items"] and d["formation"]
    assert client.get("/api/grammar/entry/nope").status_code == 404


def test_read_spots_patterns(client):
    s = client.post("/api/read", json={"text": "毎日日本語で日記を書くようにしています。"}).json()["sentences"][0]
    assert any("ようにする" in g["pattern"] for g in s["detected"])


def test_ai_routes_without_a_key(client, monkeypatch):
    monkeypatch.setattr("app.config.ai_configured", lambda: False)
    r = client.post("/api/ai/check", json={"text": "テストです。"})
    assert r.status_code == 503 and r.json()["code"] == "ai_disabled"


def test_check_shapes_claude_answer(client, monkeypatch):
    def fake(prompt, schema):
        assert "[1] 映画はとても面白いでした。" in prompt
        return {"verdict": "minor", "overall": "Fine.", "issues": [{
            "sentence": 1, "quote": "面白いでした", "severity": "error", "category": "conjugation", "why": "w", "hint": "h",
            "fix": "面白かったです", "fixedSentence": "映画はとても面白かったです。", "grammar": "〜かったです"}]}
    monkeypatch.setattr(ai, "ask", fake)
    r = client.post("/api/ai/check", json={"text": "映画を見ました。映画はとても面白いでした。"}).json()
    issue = r["issues"][0]
    assert issue["sentText"] == "映画はとても面白いでした。" and issue["grammar"]["source"] == "Genki I"


def test_explain_grades_a_guess(client, monkeypatch):
    seen = {}

    def fake(prompt, schema):
        seen["prompt"], seen["schema"] = prompt, schema
        answer = {"translation": "I make a point of writing a diary every day.", "literal": "", "parts": [], "grammar": [], "notes": ""}
        if "guess" in schema["properties"]:
            answer["guess"] = {"verdict": "close", "feedback": "You missed ようにしています."}
        return answer
    monkeypatch.setattr(ai, "ask", fake)
    body = {"sentence": "毎日日記を書くようにしています。", "guess": "I write a diary every day."}
    r = client.post("/api/ai/explain", json=body).json()
    assert "I write a diary every day." in seen["prompt"] and "guess" in seen["schema"]["required"]
    assert r["guess"] == {"text": "I write a diary every day.", "verdict": "close", "feedback": "You missed ようにしています."}
    # without a guess nothing is graded and the plain schema is used
    r = client.post("/api/ai/explain", json={"sentence": body["sentence"]}).json()
    assert r["guess"] is None and "guess" not in seen["schema"]["properties"]
