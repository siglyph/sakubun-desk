"""The three things Claude does: mark writing, say what it means, explain a sentence.

Every call asks for JSON that matches a schema (structured outputs), so the routes can
return it to the browser without guessing at the shape.
"""
from __future__ import annotations

import json

import anthropic

from . import analyzer, config, grammar

LEARNER = ("The learner is upper-intermediate: they finished Genki I and II, are working through Tobira, understand a "
           "lot of spoken Japanese but find it hard to build their own sentences, and read few kanji.")

# Models that accept the server-side refusal fallback; on these a declined request is re-run
# on a fallback model inside the same call instead of failing.
FALLBACK_MODELS = {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

_client: anthropic.Anthropic | None = None


class AIError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _get_client() -> anthropic.Anthropic:
    global _client
    if not config.ai_configured():
        raise AIError("ai_disabled", "No Anthropic API key is set, so checks and explanations are off. Add "
                      "ANTHROPIC_API_KEY to the .env file and restart the server. Readings, the dictionary and "
                      "the grammar reference work without it.", 503)
    if _client is None:
        _client = anthropic.Anthropic(timeout=180.0, max_retries=1)
    return _client


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


_S = {"type": "string"}


def ask(prompt: str, schema: dict) -> dict:
    """Send one prompt and return the JSON object Claude answers with."""
    client = _get_client()
    kwargs = dict(
        model=config.MODEL,
        max_tokens=16000,
        output_config={"effort": config.EFFORT, "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        if config.MODEL in FALLBACK_MODELS:
            response = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            response = client.messages.create(**kwargs)
    except anthropic.AuthenticationError:
        raise AIError("auth", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the .env file.")
    except anthropic.PermissionDeniedError:
        raise AIError("auth", "This API key isn’t allowed to use the configured model.")
    except anthropic.NotFoundError:
        raise AIError("config", f"The model “{config.MODEL}” wasn’t found. Check SAKUBUN_MODEL.")
    except anthropic.RateLimitError:
        raise AIError("rate_limited", "Claude is rate-limiting requests right now. Wait a minute, then try again.", 429)
    except anthropic.BadRequestError as e:
        raise AIError("bad_request", f"Claude rejected the request: {e.message}")
    except anthropic.APIStatusError as e:
        raise AIError("upstream", f"Claude returned an error ({e.status_code}). Try again shortly.")
    except anthropic.APIConnectionError:
        raise AIError("network", "Couldn’t reach the Anthropic API. Check this machine’s internet connection.")

    if response.stop_reason == "refusal":
        raise AIError("refused", "Claude declined to work on this text.")
    if response.stop_reason == "max_tokens":
        raise AIError("too_long", "The answer was cut off. Try a shorter piece of text.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise AIError("invalid_json", "The answer came back unreadable. Try again.")


def _numbered(sentences: list[dict]) -> str:
    return "\n".join(f"[{i}] {s['text']}" for i, s in enumerate(sentences))


def _intent_block(intent: str) -> str:
    return f"\nWhat they say they meant, in English:\n{intent}\n" if intent else ""


def _link(pattern: str) -> dict | None:
    g = grammar.find(pattern)
    return grammar.brief(g) if g else None


CHECK_SCHEMA = _obj({
    "verdict": {"type": "string", "enum": ["clean", "minor", "needs work"]},
    "overall": _S,
    "issues": {"type": "array", "items": _obj({
        "sentence": {"type": "integer"},
        "quote": _S,
        "severity": {"type": "string", "enum": ["error", "unnatural", "note"]},
        "category": {"type": "string", "enum": ["particle", "conjugation", "word choice", "word order", "kanji or spelling",
                                                "politeness", "meaning", "missing word", "other"]},
        "why": _S, "hint": _S, "fix": _S, "fixedSentence": _S, "grammar": _S,
    })},
})


def check(text: str, intent: str = "") -> dict:
    sentences = analyzer.split_sentences(text)
    prompt = f"""You are marking a Japanese learner's writing. {LEARNER} They want to learn by fixing their own mistakes.

Their text, split into numbered sentences:
{_numbered(sentences)}
{_intent_block(intent)}
Find every place where the Japanese is ungrammatical, uses the wrong particle, conjugation, word, kanji or politeness level, is unnatural enough that a native reader would stumble, or does not make sense{', and every place where it says something different from what they meant' if intent else ''}. Do not flag correct, natural Japanese merely because another phrasing exists. Do not invent problems: a clean text gets an empty issues list and the verdict "clean".

For each issue:
- "sentence": the number of the sentence it is in.
- "quote": the shortest exact substring of that sentence that is wrong, copied character for character. If something is missing, quote the word just before the gap.
- "severity": "error" = wrong; "unnatural" = understandable but a native speaker would not say it; "note" = optional polish.
- "why": one or two sentences in English on what is wrong and why, WITHOUT writing the corrected Japanese.
- "hint": a short nudge or question that helps them find the fix themselves, without giving the answer.
- "fix": the corrected replacement for the quote.
- "fixedSentence": the whole sentence with the smallest correction applied.
- "grammar": the grammar pattern involved in dictionary style, such as 〜たり〜たりする, or an empty string if none applies.
"overall" is one or two honest sentences in English about the text as a whole. List issues in order of position."""
    r = ask(prompt, CHECK_SCHEMA)
    issues = []
    for n, x in enumerate(r.get("issues", [])):
        i = x.get("sentence", -1)
        quote = (x.get("quote") or "").strip()
        if not quote or not x.get("why"):
            continue
        issues.append({"n": n, "quote": quote, "sentText": sentences[i]["text"] if 0 <= i < len(sentences) else "",
                       "severity": x.get("severity", "error"), "category": x.get("category", "other"),
                       "why": x["why"].strip(), "hint": x.get("hint", "").strip(), "fix": x.get("fix", "").strip(),
                       "fixedSentence": x.get("fixedSentence", "").strip(), "grammar": _link(x.get("grammar", ""))})
    return {"verdict": r.get("verdict", ""), "overall": r.get("overall", "").strip(), "issues": issues}


MEANING_SCHEMA = _obj({
    "tone": _S,
    "sentences": {"type": "array", "items": _obj({"sentence": {"type": "integer"}, "en": _S, "note": _S})},
    "match": {"type": "string", "enum": ["yes", "mostly", "no", "not given"]},
    "gap": _S,
})


def meaning(text: str, intent: str = "") -> dict:
    sentences = analyzer.split_sentences(text)
    prompt = f"""A Japanese learner wrote the text below and wants to know what it actually says to a native reader, so they can judge for themselves whether their message came across.

{_numbered(sentences)}
{_intent_block(intent)}
Translate each sentence into English faithfully to what is WRITTEN, not to what the writer probably meant. Do not silently repair mistakes: where a mistake changes or blurs the meaning, translate what the sentence actually conveys (or say that it is unclear) and describe the effect in "note" in English, without writing corrected Japanese. Use an empty string for "note" when the sentence is fine.
"tone" is a short phrase for the register, e.g. "polite (です/ます)" or "casual".
{'"match" says whether the text conveys what they meant; "gap" is one or two sentences on what differs, or an empty string.' if intent else 'They gave no intended meaning: set "match" to "not given" and "gap" to an empty string.'}"""
    r = ask(prompt, MEANING_SCHEMA)
    rows = []
    for x in r.get("sentences", []):
        i = x.get("sentence", -1)
        if x.get("en"):
            rows.append({"src": sentences[i]["text"] if 0 <= i < len(sentences) else "", "en": x["en"].strip(),
                         "note": x.get("note", "").strip()})
    match = r.get("match", "")
    return {"tone": r.get("tone", "").strip(), "rows": rows, "match": "" if match == "not given" else match,
            "gap": r.get("gap", "").strip()}


EXPLAIN_SCHEMA = _obj({
    "translation": _S,
    "literal": _S,
    "parts": {"type": "array", "items": _obj({"text": _S, "role": _S, "en": _S})},
    "grammar": {"type": "array", "items": _obj({"id": _S, "pattern": _S, "where": _S, "note": _S})},
    "notes": _S,
})


def explain(sentence: str, context: str = "") -> dict:
    candidates = grammar.detect(sentence)
    flagged = "\n".join(f"{g['id']} | {g['pattern']} | {g['meaning']}" for g in candidates)
    prompt = f"""Explain one Japanese sentence to a learner. {LEARNER}

Sentence: {sentence}
{f'It comes from this passage (for context only): {context[:1500]}' if context and context != sentence else ''}
{f'An automatic pattern matcher flagged these grammar entries as possibly present (id | pattern | meaning). Some are false alarms:{chr(10)}{flagged}' if flagged else ''}

- "translation": natural English.
- "literal": a more literal rendering that keeps the Japanese order and structure visible.
- "parts": phrase-sized chunks copied exactly from the sentence, in order, together covering the whole sentence. For each: "role" is its job in a few words (topic, time, object, place of action, verb (polite past), clause describing 人, …) and "en" is what the chunk means.
- "grammar": every grammar point above beginner particles that a learner at this level would want explained, whether or not it was flagged. For each: "id" is the id from the flagged list if that entry really is used here, otherwise an empty string; "pattern" is the pattern in dictionary style (e.g. 〜ようにする); "where" is the exact substring of the sentence where it appears; "note" is one or two sentences on what it does in THIS sentence. Leave out flagged entries that are not actually used.
- "notes": anything else worth knowing (dropped subject, nuance, register), or an empty string."""
    r = ask(prompt, EXPLAIN_SCHEMA)
    points = []
    for x in r.get("grammar", []):
        g = grammar.BY_ID.get(x.get("id", "")) or grammar.find(x.get("pattern", ""))
        if x.get("pattern") or g:
            points.append({"entry": grammar.brief(g) if g else None, "pattern": x.get("pattern", "").strip(),
                           "where": x.get("where", "").strip(), "note": x.get("note", "").strip()})
    return {"translation": r.get("translation", "").strip(), "literal": r.get("literal", "").strip(),
            "parts": [p for p in r.get("parts", []) if p.get("text")], "grammar": points, "notes": r.get("notes", "").strip()}


GRAMMAR_ASK_SCHEMA = _obj({"answer": _S, "picks": {"type": "array", "items": _obj({"id": _S, "why": _S})}})


def ask_grammar(question: str) -> dict:
    prompt = f"""A learner of Japanese is searching a grammar reference to find out how to say something. {LEARNER}

Their question, or the English they want to express: "{question}"

Reference entries (id | pattern | meaning):
{grammar.index_lines()}

Pick up to 5 entries that best answer it, best first, using only ids from the list. "answer" is one or two sentences that answer the question directly and name the pattern(s). For each pick, "why" is one sentence on why it fits and how it differs from the other picks."""
    r = ask(prompt, GRAMMAR_ASK_SCHEMA)
    picks = [{**grammar.brief(grammar.BY_ID[p["id"]]), "why": p.get("why", "").strip()}
             for p in r.get("picks", []) if p.get("id") in grammar.BY_ID]
    return {"answer": r.get("answer", "").strip(), "picks": picks[:5]}
