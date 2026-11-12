# Sakubun Desk (作文)

A self-hosted web app for practicing Japanese writing and taking apart sentences from Japanese sources. React frontend, Python (FastAPI) backend.

- **Write (書く)**: type Japanese, see it with furigana, and ask for a check only when you're done. Problems are underlined with an explanation and a hint; the corrected version stays hidden until you ask for it. "What does this say?" translates what you actually wrote. No autocomplete and no suggestions while typing.
- **Read (読む)**: paste Japanese text to get a per-sentence breakdown: words coloured by part of speech, tap a word for its dictionary form, conjugation chain, definitions and kanji, plus the grammar patterns spotted in the sentence. English is hidden behind a toggle.
- **Dictionary (辞書)**: about 191,000 JMdict entries, searchable by Japanese, kana, rōmaji or English. Conjugated forms resolve to the dictionary form.
- **Grammar (文法)**: 470 entries following the lesson order of Genki I, Genki II and Tobira, searchable by pattern, rōmaji or English idea ("or", "have to", "even if").

Furigana, the dictionary, the grammar reference and the word-by-word breakdown run entirely on your machine. The writing check, translation and sentence explanations call the Claude API and need an Anthropic API key.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer (only to build the frontend)

## Setup

Run these once, from the repository root.

Build the frontend:

```bash
cd frontend
npm install
npm run build
cd ..
```

Install the backend (macOS / Linux):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Install the backend (Windows PowerShell):

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy `.env.example` to `.env` in the repository root and add your `ANTHROPIC_API_KEY`. Skip this and the app still works, with the AI buttons reporting that no key is set.

## Run

From `backend/`, with the virtual environment active:

```bash
python -m app
```

Open http://localhost:8000. The first start takes a few extra seconds while it builds the dictionary database (`backend/data/dict.sqlite`, about 50 MB) from the JSON files.

### Reaching it from other devices

By default the server only answers on the computer it runs on. To use it from your phone or another machine on your LAN or tailnet, set `SAKUBUN_HOST=0.0.0.0` in `.env`, restart, and open `http://<that computer's address>:8000`.

There is no login. Anyone who can reach the port can use the app, and every AI request is billed to your API key, so only expose it on a network you trust (a Tailscale tailnet is a good fit) and never forward the port to the internet.

## Settings

All read from `.env` (see `.env.example`).

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables the AI features |
| `SAKUBUN_MODEL` | `claude-opus-5-5` | Claude model used for checks and explanations. `claude-sonnet-5-5` and `claude-haiku-5-5` cost less |
| `SAKUBUN_EFFORT` | `medium` | How much the model thinks: `low`, `medium` or `high` |
| `SAKUBUN_HOST` | `127.0.0.1` | Address the server listens on |
| `SAKUBUN_PORT` | `8000` | Port |

AI requests only happen when you press a button (check, "what does this say", explain, "ask Claude which structure…"). Each one is a single API call of a few thousand tokens at most.

## Development

Run the backend and the Vite dev server side by side; the dev server forwards `/api` to the backend and reloads the page as you edit.

```bash
cd backend && python -m app
```

```bash
cd frontend && npm run dev
```

Backend tests (they replace Claude with canned answers, so no key is needed):

```bash
cd backend && pip install -r requirements-dev.txt && pytest
```

## Layout

| Path | What it is |
|---|---|
| `backend/app/main.py` | FastAPI routes; also serves `frontend/dist` |
| `backend/app/analyzer.py` | Tokenizing (Janome), furigana alignment, conjugation chains |
| `backend/app/dictionary.py` | Builds and searches the SQLite dictionary |
| `backend/app/grammar.py` | Grammar search, lookup and pattern spotting |
| `backend/app/ai.py` | Prompts and Claude API calls |
| `backend/data/` | JMdict (four JSON files), KANJIDIC2 subset, grammar reference |
| `frontend/src/views/` | Write, Read, Dictionary and Grammar screens |
| `frontend/src/components/Japanese.jsx` | Furigana rendering and shared pieces |
| `frontend/src/settings.jsx` | Furigana and display preferences |

The first version of this app was a single static page published as a Claude artifact. It is in the git history (first commit on `main`).

## Caveats

- The Genki and Tobira grammar lists were compiled from memory and learner-made lists, not checked against the books. Some Tobira items may be missing or in the wrong chapter. Explanations and example sentences are original.
- Furigana comes from a tokenizer and is sometimes wrong for ambiguous readings.
- AI checks and explanations can be wrong.
- The real Claude API call has not been exercised in automated tests; they use canned answers.

## Data and licenses

- Dictionary: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), © Electronic Dictionary Research and Development Group, CC BY-SA 4.0. The files in `backend/data/` derived from them are under the same license.
- [Janome](https://github.com/mocobeta/janome) (Apache-2.0) with the IPA dictionary.
- [WanaKana](https://github.com/WaniKani/WanaKana) (MIT) and [wanakana-python](https://github.com/starwort/wanakana) (MPL-2.0).
