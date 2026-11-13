"""Sakubun Desk API. Serves the built React app from frontend/dist when it exists."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, analyzer, config, dictionary, grammar


@asynccontextmanager
async def lifespan(_: FastAPI):
    dictionary.ensure_built()
    grammar.load()
    analyzer.analyze("準備")          # load the tokenizer now, not on the first request
    yield


app = FastAPI(title="Sakubun Desk", lifespan=lifespan)


@app.exception_handler(ai.AIError)
async def ai_error(_, exc: ai.AIError):
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})


class TextIn(BaseModel):
    text: str = Field(max_length=20000)


class WritingIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    intent: str = Field(default="", max_length=3000)


class ExplainIn(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    context: str = Field(default="", max_length=6000)
    guess: str = Field(default="", max_length=1000)      # the learner's own attempt at the meaning


class QuestionIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)


@app.get("/api/status")
def status():
    return {"ai": {"enabled": config.ai_configured(), "model": config.MODEL},
            "dictionary": {"entries": dictionary.count()}, "grammar": {"entries": len(grammar.ENTRIES)}}


# ---- readings ----
@app.post("/api/analyze")
def analyze(body: TextIn):
    """Text -> words with readings, for the furigana preview."""
    return {"items": analyzer.analyze(body.text)}


@app.post("/api/read")
def read(body: TextIn):
    """Text -> sentences, each with its words and the reference patterns spotted in it."""
    return {"sentences": [{"text": s["text"], "items": analyzer.analyze(s["text"]),
                           "detected": [grammar.brief(g) for g in grammar.detect(s["text"])]}
                          for s in analyzer.split_sentences(body.text)]}


# ---- dictionary ----
@app.get("/api/dict/search")
def dict_search(q: str = Query("", max_length=200), dir: str = Query("auto", pattern="^(auto|je|ej)$"),
                cls: str = Query("", max_length=8), base: str = Query("", max_length=200)):
    return dictionary.search(q, dir, cls, base)


@app.get("/api/kanji/levels")
def kanji_levels():
    return dictionary.kanji_levels()


# ---- grammar ----
@app.get("/api/grammar/meta")
def grammar_meta():
    return grammar.meta()


@app.get("/api/grammar")
def grammar_search(q: str = Query("", max_length=200), source: str = "", lesson: int | None = None, category: str = ""):
    return {"items": grammar.search(q, source, lesson, category)}


@app.get("/api/grammar/for-word")
def grammar_for_word(base: str = Query(max_length=100), surface: str = Query("", max_length=100)):
    return {"items": grammar.for_word(base, surface or base)}


@app.get("/api/grammar/entry/{gid}")
def grammar_entry(gid: str):
    entry = grammar.detail(gid)
    if not entry:
        raise HTTPException(404, "No such grammar entry")
    return entry


# ---- Claude ----
@app.post("/api/ai/check")
def ai_check(body: WritingIn):
    return ai.check(body.text, body.intent.strip())


@app.post("/api/ai/meaning")
def ai_meaning(body: WritingIn):
    return ai.meaning(body.text, body.intent.strip())


@app.post("/api/ai/explain")
def ai_explain(body: ExplainIn):
    return ai.explain(body.sentence.strip(), body.context, body.guess.strip())


@app.post("/api/ai/grammar")
def ai_grammar(body: QuestionIn):
    return ai.ask_grammar(body.question.strip())


if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
