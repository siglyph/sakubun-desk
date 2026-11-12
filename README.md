# Sakubun Desk (作文)

A small web app for practicing Japanese writing and taking apart sentences from Japanese sources.

- **Write (書く)**: type Japanese, see it with furigana, and ask for a check only when you're done. Problems are underlined with an explanation and a hint; the corrected version stays hidden until you ask for it. "What does this say?" translates what you actually wrote. No autocomplete, no suggestions while typing.
- **Read (読む)**: paste Japanese text to get a per-sentence breakdown: words coloured by part of speech, tap a word for its dictionary form, conjugation chain, definitions and kanji, plus the grammar patterns spotted in the sentence. English is hidden behind a toggle.
- **Dictionary (辞書)**: about 191,000 JMdict entries, searchable by Japanese, kana, rōmaji or English. Conjugated forms resolve to the dictionary form.
- **Grammar (文法)**: 470 entries following the lesson order of Genki I, Genki II and Tobira, searchable by pattern, rōmaji or English idea ("or", "have to", "even if").

## Layout

| Path | What it is |
|---|---|
| `index.html` | Page markup and styles (a body fragment; the host wraps it in a document) |
| `app.js` | All app logic |
| `lib/` | kuromoji.js (tokenizer, loader patched to read base64 text) and wanakana |
| `dict/` | kuromoji IPA dictionary, gzip then base64 |
| `data/` | JMdict split into a common set and three overflow files, KANJIDIC2 subset, grammar reference |

## Running it

Everything except the AI features is static and works from any web server:

```bash
python3 -m http.server 8000
```

The writing check, translation and sentence explanations call Claude through the Claude artifact runtime (`window.claude.use("sample")`), so they only work when the page is published as a Claude artifact. Outside that, those buttons report that Claude isn't available. Hosting it elsewhere with AI features would mean replacing the `ask()` function in `app.js` with a call to your own backend.

## Caveats

- The Genki and Tobira grammar lists were compiled from memory and learner-made lists, not checked against the books. Some Tobira items may be missing or in the wrong chapter. Explanations and example sentences are original.
- Furigana comes from a tokenizer and is sometimes wrong for ambiguous readings.
- AI checks and explanations can be wrong.

## Data and licenses

- Dictionary: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), © Electronic Dictionary Research and Development Group, CC BY-SA 4.0. The files in `data/` derived from them are under the same license.
- [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache-2.0) with the IPA dictionary (its own license, see the kuromoji repository).
- [WanaKana](https://github.com/WaniKani/WanaKana) (MIT).
