/* Sakubun Desk — write Japanese, check it when you ask, and take other people's sentences apart.
   Local: readings (kuromoji), dictionary (JMdict), kanji (KANJIDIC2), grammar reference.
   Claude (only on a button press): writing check, "what does this say", sentence explanations. */
(() => {
'use strict';

// ---------- small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('sakubun.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sakubun.' + k, JSON.stringify(v)); } catch { /* storage is a convenience only */ } },
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fetchJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
const narrow = () => window.matchMedia('(max-width: 980px)').matches;

const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆ヶヵ]/;
const JP_RE = /[぀-ヿ㐀-鿿]/;
const hasKanji = s => KANJI_RE.test(s);
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKata = s => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

// ---------- settings ----------
const S = Object.assign({ furi: 'always', skip: 0, known: '', script: 'hira', font: 'gothic', size: 'm' }, store.get('settings', {}));
let KNOWN = new Set(S.known);
let KANJI = {};            // literal -> [strokes, grade, oldJLPT, on, kun, meanings]
function applySettings() {
  const r = document.documentElement;
  r.dataset.furi = S.furi; r.dataset.font = S.font; r.dataset.size = S.size;
  KNOWN = new Set(S.known);
}
function knownKanji(c) {
  if (c === '々' || KNOWN.has(c)) return true;
  const k = KANJI[c];
  return !!(S.skip && k && k[2] && k[2] >= S.skip);
}
const needsFurigana = word => [...word].some(c => KANJI_RE.test(c) && !knownKanji(c));
const showReading = r => S.script === 'kata' ? toKata(r) : S.script === 'romaji' ? window.wanakana.toRomaji(r) : r;

// ---------- readings: split a word into [text, reading|null] pieces ----------
function align(surface, reading) {
  if (!reading || !hasKanji(surface)) return [[surface, null]];
  const runs = surface.match(/[㐀-䶿一-鿿豈-﫿々〆ヶヵ]+|[^㐀-䶿一-鿿豈-﫿々〆ヶヵ]+/g);
  const isK = runs.map(r => KANJI_RE.test(r[0]));
  const re = new RegExp('^' + runs.map((r, i) => isK[i] ? '(.+?)' : '(' + escRe(toHira(r)) + ')').join('') + '$');
  const m = reading.match(re);
  if (!m) return [[surface, reading]];
  return runs.map((r, i) => [r, isK[i] ? m[i + 1] : null]);
}
function rubyInto(el, parts, word) {
  const want = needsFurigana(word);
  for (const [text, r] of parts) {
    if (r && want) el.append(h('ruby', null, text, h('rt', { text: showReading(r) })));
    else el.append(text);
  }
  return el;
}

// ---------- tokenizer ----------
let TOK = null;
const tokReady = new Promise((res, rej) => {
  if (!window.kuromoji) return rej(new Error('kuromoji missing'));
  window.kuromoji.builder({ dicPath: 'dict/' }).build((err, t) => err ? rej(err) : (TOK = t, res(t)));
});
const READING_FIX = { '日本': 'ニホン', '日本人': 'ニホンジン', '私': 'ワタシ', '明日': 'アシタ', '何': 'ナニ' };
const INFL = new Set(['動詞', '形容詞', '助動詞']);
const NO_MERGE_AUX = new Set(['です', 'だ', 'らしい', 'べし', 'まい', 'ごとし']);
const MERGE_PART = new Set(['て', 'で', 'ば', 'たり', 'だり']);
function canJoin(g, t) {
  const last = g.tokens[g.tokens.length - 1];
  if (!INFL.has(last.pos)) return false;
  if (t.pos === '助動詞') return !NO_MERGE_AUX.has(t.basic_form);
  if (t.pos === '助詞') return (t.pos_detail_1 === '接続助詞' || t.pos_detail_1 === '並立助詞') && MERGE_PART.has(t.basic_form) && last.conjugated_form !== '基本形';
  return t.pos === '動詞' && t.pos_detail_1 === '接尾';
}
const POS_LABEL = {
  '名詞': { '': 'noun', '代名詞': 'pronoun', '固有名詞': 'proper noun', '数': 'number', '形容動詞語幹': 'na-adjective', 'サ変接続': 'noun (takes する)', '接尾': 'suffix / counter', '非自立': 'dependent noun', '副詞可能': 'noun (also adverbial)' },
  '動詞': { '': 'verb', '非自立': 'helper verb', '接尾': 'verb ending' },
  '形容詞': { '': 'i-adjective' }, '副詞': { '': 'adverb' }, '助動詞': { '': 'auxiliary' }, '連体詞': { '': 'pre-noun word' },
  '接続詞': { '': 'conjunction' }, '感動詞': { '': 'interjection' }, '接頭詞': { '': 'prefix' }, 'フィラー': { '': 'filler' },
  '助詞': { '': 'particle', '格助詞': 'case particle', '係助詞': 'topic / focus particle', '接続助詞': 'conjunctive particle', '終助詞': 'sentence-ending particle', '副助詞': 'adverbial particle', '並立助詞': 'listing particle', '連体化': 'linking particle (の)', '副詞化': 'adverb-forming particle' },
};
const POS_CLASS = { '名詞': 'n', '動詞': 'v', '形容詞': 'adj', '副詞': 'adv', '助詞': 'p', '助動詞': 'aux', '連体詞': 'adj', '接続詞': 'adv', '感動詞': 'adv', '接頭詞': 'n' };
const AUX_LABEL = { 'ます': 'polite', 'た': 'past', 'ない': 'negative', 'ぬ': 'negative', 'ん': 'negative', 'たい': 'want to', 'たがる': 'seems to want to',
  'れる': 'passive / honorific', 'られる': 'passive / potential / honorific', 'せる': 'causative', 'させる': 'causative', 'う': 'volitional', 'よう': 'volitional',
  'て': 'て-form', 'で': 'て-form', 'ば': 'ば conditional', 'たり': 'たり form', 'だり': 'たり form', 'です': 'polite copula', 'だ': 'copula', 'がる': 'shows signs of' };
const FORM_LABEL = { '連用形': 'stem (ます-stem)', '連用タ接続': 'stem used before て / た', '連用テ接続': 'く form', '未然形': 'ない-stem', '未然ウ接続': 'volitional stem',
  '仮定形': 'ば-stem', '命令ｒｏ': 'command form', '命令ｙｏ': 'command form', '命令ｅ': 'command form', '命令ｉ': 'command form', '体言接続': 'noun-modifying form',
  'ガル接続': 'stem', '仮定縮約１': 'contracted conditional', '未然レル接続': 'ない-stem', '未然ヌ接続': 'ない-stem' };
function typeLabel(t) {
  if (!t || t === '*') return '';
  if (t.startsWith('一段')) return 'ichidan (ru-verb)';
  if (t.startsWith('五段')) return 'godan (u-verb)';
  if (t.startsWith('サ変')) return 'irregular する';
  if (t.startsWith('カ変')) return 'irregular 来る';
  if (t.startsWith('形容詞')) return 'i-adjective';
  return '';
}
function finishWord(g) {
  const head = g.tokens[0];
  g.base = head.basic_form && head.basic_form !== '*' ? head.basic_form : head.surface_form;
  g.cls = head.pos === '名詞' && head.pos_detail_1 === '形容動詞語幹' ? 'adj' : (POS_CLASS[head.pos] || '');
  const pl = POS_LABEL[head.pos] || {};
  g.label = pl[head.pos_detail_1] || pl[''] || '';
  g.parts = []; g.reading = '';
  for (const t of g.tokens) {
    const raw = READING_FIX[t.surface_form] && t.pos === '名詞' ? READING_FIX[t.surface_form] : t.reading;
    const r = raw && raw !== '*' ? toHira(raw) : (hasKanji(t.surface_form) ? '' : toHira(t.surface_form));
    g.reading += r;
    g.parts.push(...align(t.surface_form, r));
  }
  g.steps = [];
  if (INFL.has(head.pos) && (g.tokens.length > 1 || (head.conjugated_form && head.conjugated_form !== '基本形'))) {
    g.vtype = typeLabel(head.conjugated_type);
    if (g.tokens.length === 1 && FORM_LABEL[head.conjugated_form]) g.steps.push(FORM_LABEL[head.conjugated_form]);
    for (const t of g.tokens.slice(1)) g.steps.push({ jp: t.surface_form, label: AUX_LABEL[t.basic_form] || '' });
  }
}
function analyze(text) {
  const items = []; let lineStart = 0;
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) items.push({ type: 'nl', surface: '\n', start: lineStart - 1, end: lineStart });
    let g = null;
    for (const t of line ? TOK.tokenize(line) : []) {
      const s = t.surface_form, start = lineStart + t.word_position - 1;
      if (t.pos === '記号' || !s.trim()) { items.push({ type: 'punct', surface: s, start, end: start + s.length }); g = null; continue; }
      if (g && canJoin(g, t)) { g.tokens.push(t); g.surface += s; g.end = start + s.length; }
      else { g = { type: 'word', tokens: [t], surface: s, start, end: start + s.length }; items.push(g); }
    }
    lineStart += line.length + 1;
  });
  for (const it of items) if (it.type === 'word') finishWord(it);
  return items;
}
function wordEl(g) {
  const el = h('span', { class: 'w' + (g.cls ? ' p-' + g.cls : ''), tabindex: '0', role: 'button' });
  rubyInto(el, g.parts, g.surface);
  el._g = g;
  return el;
}
function jpInto(el, text) {              // plain Japanese text -> text with readings (not clickable)
  el.replaceChildren();
  if (!TOK) { el.textContent = text; return el; }
  for (const it of analyze(text)) {
    if (it.type === 'word') rubyInto(el, it.parts, it.surface); else el.append(it.surface);
  }
  return el;
}
function splitSentences(text) {
  const out = []; const re = /[^。！？!?\n]+[。！？!?]*[」』）)]*/g; let m;
  while ((m = re.exec(text))) {
    const lead = m[0].length - m[0].trimStart().length, t = m[0].trim();
    if (t) out.push({ text: t, start: m.index + lead });
  }
  return out;
}

// ---------- Claude (only ever called from a click) ----------
const sampleP = (window.claude && typeof window.claude.use === 'function' ? window.claude.use('sample') : Promise.resolve(null)).catch(() => null);
async function ask(prompt, signal) {
  const s = await sampleP;
  if (!s) throw { code: 'unavailable' };
  return s.json(prompt, { signal });
}
function aiMessage(e) {
  switch (e && e.code) {
    case 'cancelled': return '';
    case 'unavailable': case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed':
      return 'Claude isn’t available in this view, so checks and explanations are off. Open the page in Claude and allow it to use Claude when asked. Readings, the dictionary and the grammar reference work without it.';
    case 'rate_limited': return 'Too many requests just now. Wait a minute, then try again.';
    case 'session_expired': return 'You’ve been signed out. Sign in again, then retry.';
    case 'refused': return 'Claude declined to work on this text.';
    case 'prompt_too_large': return 'That’s too much text to send at once. Try a shorter piece.';
    case 'invalid_json': case 'empty_completion': return 'The answer came back unreadable. Try again.';
    default: return 'Couldn’t reach Claude. Try again.';
  }
}
function busyRow(label, ctl) {
  return h('div', { class: 'status' }, h('span', { class: 'spin' }), h('span', { text: label }), h('button', { class: 'link', text: 'Stop', onclick: () => ctl.abort() }));
}
const str = v => typeof v === 'string' ? v.trim() : '';
const LEARNER = 'The learner is upper-intermediate: they finished Genki I and II, are working through Tobira, understand a lot of spoken Japanese but find it hard to build their own sentences, and read few kanji.';

// ---------- navigation ----------
const NAV = { main: store.get('main', 'write'), ref: store.get('ref', 'dict'), focus: 'main' };
function paintNav() {
  $('#view-write').hidden = NAV.main !== 'write';
  $('#view-read').hidden = NAV.main !== 'read';
  $('#ref-dict').hidden = NAV.ref !== 'dict';
  $('#ref-grammar').hidden = NAV.ref !== 'grammar';
  document.body.dataset.focus = NAV.focus;
  for (const b of $$('[data-main]')) b.setAttribute('aria-selected', String(b.dataset.main === NAV.main && (!b.closest('.bottomnav') || NAV.focus === 'main')));
  for (const b of $$('[data-ref]')) b.setAttribute('aria-selected', String(b.dataset.ref === NAV.ref && (!b.closest('.bottomnav') || NAV.focus === 'ref')));
  store.set('main', NAV.main); store.set('ref', NAV.ref);
  const name = NAV.focus === 'ref' && narrow() ? (NAV.ref === 'dict' ? 'dictionary' : 'grammar') : NAV.main;
  try { history.replaceState(null, '', '#' + name); } catch { /* hash is optional */ }
}
function setMain(v) { NAV.main = v; NAV.focus = 'main'; delete document.body.dataset.return; paintNav(); }
function setRef(v, fromText) {
  NAV.ref = v; NAV.focus = 'ref';
  if (fromText) document.body.dataset.return = '1'; else delete document.body.dataset.return;
  paintNav();
  if (v === 'grammar') renderGrammar(); else runDict();
  if (narrow()) window.scrollTo(0, 0);
}
function fromHash() {
  const n = location.hash.slice(1);
  if (n === 'write' || n === 'read') { NAV.main = n; NAV.focus = 'main'; }
  else if (n === 'dictionary' || n === 'grammar') { NAV.ref = n === 'grammar' ? 'grammar' : 'dict'; NAV.focus = 'ref'; }
}

// ---------- dictionary ----------
const D = { pos: [], misc: [], e: [], idx: new Map(), ready: false, full: false, dir: 'auto', ctx: null, loading: null, loadingFull: null };
function addEntries(arr) {
  const base = D.e.length;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]; D.e.push(e);
    const forms = e[0] ? e[0].split(';').concat(e[1].split(';')) : e[1].split(';');
    for (const f of forms) { const a = D.idx.get(f); if (a) a.push(base + i); else D.idx.set(f, [base + i]); }
  }
}
function loadDict() {
  return D.loading || (D.loading = (async () => {
    const j = await fetchJSON('data/dict-common.json');
    D.pos = j.pos; D.misc = j.misc; addEntries(j.e); D.ready = true;
  })());
}
function loadFull() {
  return D.loadingFull || (D.loadingFull = (async () => {
    await loadDict();
    for (let i = 1; i <= 3; i++) addEntries((await fetchJSON(`data/dict-more-${i}.json`)).e);
    D.full = true;
  })());
}
const CTX_POS = { p: /particle/, v: /verb/, adj: /adjective|pre-noun/, adv: /adverb|conjunction|interjection/, aux: /auxiliary|copula|particle/, n: /noun|pronoun|counter|suffix|prefix|numeric/ };
function ctxScore(e, c) {            // how well a dictionary entry fits the word that was tapped in a text
  if (!c) return 0;
  let sc = 0;
  const re = CTX_POS[c.cls];
  if (re && e[2].some(s => s[0].some(i => re.test(D.pos[i])))) sc += 400;
  if (!hasKanji(c.base) && e[0] && !e[2].some(s => (s[2] || []).some(i => D.misc[i] === 'usually kana'))) sc -= 150;
  return sc;
}
function exactEntries(form, c) {
  const ids = D.idx.get(form) || [];
  return ids.map(i => D.e[i]).sort((a, b) => (b[3] + ctxScore(b, c)) - (a[3] + ctxScore(a, c)));
}
function searchJP(q, limit = 40) {
  const qs = [...new Set([q, toHira(q), toKata(q)])];
  const out = [];
  for (const e of D.e) {
    let best = 0;
    const k = e[0], r = e[1];
    let hit = false;
    for (const s of qs) if (k.includes(s) || r.includes(s)) { hit = true; break; }
    if (!hit) continue;
    const forms = k ? k.split(';').concat(r.split(';')) : r.split(';');
    for (const f of forms) for (const s of qs) {
      let sc = 0;
      if (f === s) sc = 1000;
      else if (f.startsWith(s)) sc = 600 - (f.length - s.length) * 8;
      else if (f.includes(s)) sc = 300 - (f.length - s.length) * 8;
      if (sc > best) best = sc;
    }
    if (best > 0) out.push([best + e[3], e, best >= 1000]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit);
}
function searchEN(q, limit = 40) {
  const ql = q.toLowerCase();
  const word = new RegExp('(^|[^a-z])' + escRe(ql) + '($|[^a-z])');
  const out = [];
  for (const e of D.e) {
    let best = 0, exact = false;
    const ss = e[2];
    for (let si = 0; si < ss.length; si++) {
      const gl = ss[si][1].toLowerCase();
      if (!gl.includes(ql)) continue;
      const parts = gl.split('; ');
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        const core = part.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        let sc = 0;
        if (core === ql || core === 'to ' + ql || core === 'to be ' + ql) sc = 900 - pi * 30;
        else if (word.test(part)) sc = ((core.startsWith(ql + ' ') || core.startsWith('to ' + ql + ' ')) ? 480 : 340) - pi * 15 - Math.min(core.length, 60);
        sc -= si * 50;
        if (sc > best) { best = sc; exact = sc > 600; }
      }
    }
    if (best > 0) out.push([best + e[3] * 2, e, exact]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit);
}
const GRADE = g => g >= 1 && g <= 6 ? `taught in grade ${g}` : g === 8 ? 'taught in secondary school' : g >= 9 ? 'used in names' : 'not a school kanji';
const JLPT = { 4: 'N5', 3: 'N4', 2: 'N3–N2', 1: 'N1' };
function kanjiCard(c) {
  const k = KANJI[c];
  return h('div', { class: 'kcard' },
    h('div', { class: 'big', lang: 'ja', text: c }),
    h('div', null, h('div', { class: 'k', text: 'Meaning' }), h('div', { text: k[5] || '—' })),
    h('div', null, h('div', { class: 'k', text: 'On reading' }), h('div', { lang: 'ja', text: k[3] || '—' })),
    h('div', null, h('div', { class: 'k', text: 'Kun reading' }), h('div', { lang: 'ja', text: k[4] || '—' })),
    h('div', { class: 'muted tiny', text: `${k[0]} strokes · ${GRADE(k[1])}${k[2] ? ' · JLPT ' + JLPT[k[2]] : ''}` }));
}
function entryEl(e) {
  const K = e[0] ? e[0].split(';') : [], R = e[1].split(';');
  const hw = h('span', { class: 'hw', lang: 'ja' });
  if (K.length) rubyInto(hw, align(K[0], toHira(R[0])), K[0]); else hw.textContent = R[0];
  const head = h('div', { class: 'entry-head' }, hw, K.length ? h('span', { class: 'alt', lang: 'ja', text: S.script === 'romaji' ? `${R[0]} · ${showReading(toHira(R[0]))}` : R[0] }) : null, e[3] >= 50 ? h('span', { class: 'badge', text: 'common' }) : null);
  const alts = K.slice(1).concat(R.slice(1));
  const senses = h('ol', { class: 'senses' });
  let lastPos = '';
  for (const s of e[2]) {
    const pos = s[0].map(i => D.pos[i]).join(', ');
    const li = h('li', null, pos && pos !== lastPos ? h('span', { class: 'postag', text: pos }) : null, s[1]);
    lastPos = pos;
    const misc = (s[2] || []).map(i => D.misc[i]).concat(s[3] ? [s[3]] : []);
    if (misc.length) li.append(h('span', { class: 'misc', text: misc.join(' · ') }));
    senses.append(li);
  }
  const el = h('div', { class: 'entry' }, head, alts.length ? h('div', { class: 'alt', lang: 'ja', text: 'Also: ' + alts.slice(0, 6).join('、') }) : null, senses);
  const ks = K.length ? [...new Set([...K[0]].filter(c => KANJI[c]))] : [];
  if (ks.length) {
    const slot = h('div');
    el.append(h('div', { class: 'kanji-row' }, h('span', { class: 'muted tiny', text: 'Kanji' }), ks.map(c => h('button', {
      class: 'kbtn', lang: 'ja', text: c, 'aria-expanded': 'false', onclick: ev => {
        const open = ev.currentTarget.getAttribute('aria-expanded') === 'true';
        $$('.kbtn', el).forEach(b => b.setAttribute('aria-expanded', 'false'));
        slot.replaceChildren();
        if (!open) { ev.currentTarget.setAttribute('aria-expanded', 'true'); slot.append(kanjiCard(c)); }
      } }))), slot);
  }
  return el;
}
function stepsEl(c) {
  const el = h('div', { class: 'steps' }, h('b', { lang: 'ja', text: c.base }), c.vtype ? h('span', { class: 'muted', text: c.vtype }) : null);
  for (const s of c.steps) {
    el.append(h('span', { class: 'arrow', text: '→' }));
    if (typeof s === 'string') el.append(h('span', { text: s }));
    else el.append(h('span', null, h('b', { lang: 'ja', text: s.jp }), s.label ? ' ' + s.label : ''));
  }
  return el;
}
function ctxEl(c) {
  const el = h('div', { class: 'ctx' }, h('div', { class: 'muted tiny', text: 'In your text' }),
    h('div', { class: 'jp', lang: 'ja' }, rubyInto(document.createDocumentFragment(), c.parts, c.surface)),
    h('div', { class: 'tiny' }, c.label + (c.reading && c.reading !== c.surface ? ' · read ' : ''), c.reading && c.reading !== c.surface ? h('span', { lang: 'ja', text: showReading(c.reading) }) : null));
  if (c.steps.length) el.append(stepsEl(c));
  const gs = grammarForWord(c);
  if (gs.length) el.append(h('div', { class: 'chips' }, h('span', { class: 'muted tiny', text: 'Grammar notes' }), gs.map(grammarChip)));
  return el;
}
let dictRun = 0;
async function runDict() {
  const my = ++dictRun, out = $('#dictOut'), q = $('#dictQ').value.trim();
  if (!D.ready) {
    out.replaceChildren(h('div', { class: 'status', style: 'padding-top:14px' }, h('span', { class: 'spin' }), 'Loading the dictionary…'));
    try { await loadDict(); } catch { out.replaceChildren(h('div', { class: 'empty', text: 'The dictionary file didn’t load. Reload the page to try again.' })); return; }
    if (my !== dictRun) return;
  }
  const nodes = [];
  if (D.ctx && D.ctx.base === q) nodes.push(ctxEl(D.ctx)); else D.ctx = null;
  if (!q) {
    nodes.push(h('div', { class: 'empty' }, h('div', { text: 'Look a word up in either direction. Type Japanese, kana, rōmaji or English.' }),
      h('div', { class: 'tiny', text: 'Nothing here pastes into your writing. Type the word yourself; that’s part of the practice.' })));
    out.replaceChildren(...nodes); return;
  }
  const groups = [];
  let total = 0;
  if (JP_RE.test(q)) {
    const res = searchJP(q);
    const anyExact = res.some(r => r[2]);
    if (!anyExact && TOK) {
      const words = analyze(q).filter(i => i.type === 'word');
      if (words.length === 1 && words[0].base !== q) {
        const ex = exactEntries(words[0].base);
        if (ex.length) { groups.push({ title: `Dictionary form: ${words[0].base}`, steps: words[0], list: ex.slice(0, 8) }); }
      } else if (words.length > 1) {
        const seen = new Set(), list = [];
        for (const w of words) { const e = exactEntries(w.base)[0]; if (e && !seen.has(e)) { seen.add(e); list.push(e); } }
        if (list.length) groups.push({ title: 'Word by word', list });
      }
    }
    if (D.ctx && anyExact) {
      const ex = exactEntries(q, D.ctx), set = new Set(ex);
      groups.push({ title: '', list: ex.concat(res.map(r => r[1]).filter(e => !set.has(e))).slice(0, 40) });
    } else if (res.length) groups.push({ title: groups.length ? `Entries containing ${q}` : '', list: res.map(r => r[1]) });
  } else {
    const kana = window.wanakana.toHiragana(q.toLowerCase());
    const validKana = /^[ぁ-ゖー]+$/.test(kana);
    let jp = [], en = [];
    if (D.dir !== 'ej' && validKana) jp = searchJP(kana).filter(r => D.dir === 'je' || r[0] >= 560);
    if (D.dir !== 'je') en = searchEN(q);
    const gj = { title: `Japanese words read “${kana}”`, list: jp.map(r => r[1]) }, ge = { title: `Japanese for “${q}”`, list: en.map(r => r[1]) };
    const enFirst = D.dir === 'ej' || (en.length && en[0][2]) || !jp.some(r => r[2]);
    for (const g of enFirst ? [ge, gj] : [gj, ge]) if (g.list.length) groups.push(g);
  }
  for (const g of groups) {
    if (g.title) nodes.push(h('div', { class: 'sechead', text: g.title }));
    if (g.steps && g.steps.steps.length) nodes.push(h('div', { style: 'padding-top:6px' }, stepsEl(g.steps)));
    for (const e of g.list) { nodes.push(entryEl(e)); total++; }
  }
  if (!total) nodes.push(h('div', { class: 'empty', text: D.full ? `Nothing found for “${q}”.` : `Nothing for “${q}” among the common words. Searching the full dictionary…` }));
  if (!D.full) {
    nodes.push(h('div', { class: 'muted tiny', style: 'padding-top:12px' }, `Searched ${D.e.length.toLocaleString()} common words. `,
      h('button', { class: 'link', text: 'Search all 191,000 entries', onclick: async ev => { ev.currentTarget.replaceWith(h('span', { text: 'Loading the full dictionary (15 MB)…' })); await loadFull().catch(() => {}); runDict(); } })));
  }
  out.replaceChildren(...nodes);
  out.scrollTop = 0;
  if (!total && !D.full) { await loadFull().catch(() => {}); if (my === dictRun && D.full) runDict(); }
}
function lookupWord(g) {
  D.ctx = g; D.dir = 'auto';
  $('#dictQ').value = g.base;
  setRef('dict', true);
}

// ---------- grammar reference ----------
let G = [], GBY = new Map();
const GR = { src: '', lesson: '', cat: '', open: null, ai: null };
const CATS = { particles: 'Particles', basics: 'Basic sentences', 'verb-forms': 'Verb forms', adjectives: 'Adjectives', 'tense-aspect': 'Ongoing, finished, prepared (aspect)',
  listing: 'Listing: and / or', reason: 'Reasons and causes', purpose: 'Purpose: in order to', condition: 'If / when (conditions)', contrast: 'But / although', time: 'Time: when, before, after, while',
  comparison: 'Comparing and degree', desire: 'Wants, plans, decisions', request: 'Requests, invitations, advice', permission: 'Permission and prohibition', obligation: 'Must / should / supposed to',
  ability: 'Can / easy / hard to', giving: 'Giving and receiving', quotation: 'Quoting, hearsay, embedded questions', conjecture: 'Seems / probably / might', voice: 'Passive and causative',
  keigo: 'Honorific and humble speech', nominalization: 'Turning clauses into nouns', change: 'Change and experience', emphasis: 'Only / even / emphasis', discourse: 'Connecting sentences', expression: 'Set expressions' };
const gnorm = s => s.replace(/[A-Za-z0-9\s〜~～・…。、，,()（）「」＋+\-ー]/g, '');
function prepGrammar(list) {
  G = list; GBY = new Map();
  const order = { 'Genki I': 0, 'Genki II': 1, 'Tobira': 2 };
  G.sort((a, b) => (order[a.source] - order[b.source]) || (a.lesson - b.lesson));
  for (const g of G) {
    GBY.set(g.id, g);
    g._keys = g.pattern.split(/\s*[\/／]\s*/).map(gnorm).filter(Boolean);
    g._re = []; for (const m of g.match || []) { try { g._re.push(new RegExp(m)); } catch { /* skip a bad pattern */ } }
    g._kw = (g.keywords || []).map(k => k.toLowerCase());
    g._text = (g.meaning + ' ' + g.explanation).toLowerCase();
    g._tag = (g.source === 'Genki I' ? 'Genki I · L' : g.source === 'Genki II' ? 'Genki II · L' : 'Tobira · Ch') + g.lesson;
  }
  const cat = $('#gramCat');
  for (const [id, label] of Object.entries(CATS)) if (G.some(g => g.category === id)) cat.append(h('option', { value: id, text: label }));
}
function findGrammar(name) {            // link a pattern name (from Claude or "see also") to an entry
  const n = gnorm(name || ''); if (!n) return null;
  let best = null, bs = 0;
  for (const g of G) for (const k of g._keys) {
    let sc = 0;
    if (k === n) sc = 100; else if (n.length >= 2 && k.length >= 2 && (k.includes(n) || n.includes(k))) sc = 60 * Math.min(k.length, n.length) / Math.max(k.length, n.length);
    if (sc > bs) { bs = sc; best = g; }
  }
  return bs >= 40 ? best : null;
}
function grammarForWord(c) {
  if (!G.length) return [];
  const keys = new Set([c.base, c.surface]);
  const out = [], seen = new Set();
  for (const g of G) if (g._keys.some(k => keys.has(k)) && !seen.has(g._keys[0])) { seen.add(g._keys[0]); out.push(g); }
  return out.slice(0, 6);
}
function detectGrammar(text) {       // regex spotting; rarer structures win the limited chip space
  const hits = [], seen = new Set();
  for (const g of G) for (const re of g._re) {
    const m = re.exec(text);
    if (m && m[0]) {
      const key = g._keys[0], span = m.index + ':' + m[0];
      if (!seen.has(key) && !seen.has(span)) { seen.add(key); seen.add(span); hits.push({ g, at: m.index }); }
      break;
    }
  }
  return hits.sort((a, b) => (a.g.f || 0) - (b.g.f || 0)).slice(0, 8).sort((a, b) => a.at - b.at).map(x => x.g);
}
function grammarChip(g, maybe) {
  return h('button', { class: 'chip' + (maybe === true ? ' maybe' : ''), lang: 'ja', onclick: () => openGrammar(g.id, true) }, g.pattern.split(/\s*[\/／]\s*/)[0], h('small', { text: g._tag }));
}
function openGrammar(id, fromText) { GR.open = id; setRef('grammar', fromText); }
const STOP = new Set('i you he she it we they a an the to do does did is am are was were be x y z and of in on at my me this that how what say want'.split(' '));
function scoreGrammar(g, q) {
  const ql = q.toLowerCase().trim();
  let sc = 0;
  if (JP_RE.test(q)) {
    const n = gnorm(q);
    for (const k of g._keys) { if (k === n) sc += 20; else if (n && k.includes(n)) sc += 10 - Math.min(6, k.length - n.length); }
    if (!sc && n.length >= 4 && g._re.some(re => re.test(q))) sc += 6;
    if (!sc && n && g.examples.some(ex => ex.ja.includes(q))) sc += 1;
    return sc;
  }
  const rom = g.romaji.toLowerCase();
  if (rom === ql) sc += 18; else if (ql.length >= 2 && rom.split(/[\s\/]+/).includes(ql)) sc += 12; else if (ql.length >= 3 && rom.includes(ql)) sc += 6;
  const wordRe = w => new RegExp('(^|[^a-z])' + escRe(w) + '($|[^a-z])');
  for (const kw of g._kw) {
    if (kw === ql) sc += 14;
    else if (kw.length >= 2 && wordRe(kw).test(ql)) sc += 4 + Math.min(kw.length, 12) * 0.3;
    else if (ql.length >= 3 && kw.includes(ql)) sc += 4;
  }
  const toks = ql.split(/[^a-z'-]+/).filter(t => t.length > 1 && !STOP.has(t));
  for (const t of toks) {
    const re = wordRe(t);
    if (re.test(g.meaning.toLowerCase())) sc += 3; else if (re.test(g._text)) sc += 0.6;
    if (g.id.includes(t)) sc += 1;
  }
  return sc;
}
function grammarDetail(g) {
  const el = h('div', { class: 'gdetail' },
    h('div', null, h('button', { class: 'link', text: '← All results', onclick: () => { GR.open = null; renderGrammar(); } })),
    h('div', null, h('h2', { lang: 'ja', text: g.pattern }), h('div', { text: g.meaning }), h('div', { class: 'gsrc', text: `${g._tag.replace('· L', '· Lesson ').replace('· Ch', '· Chapter ')} · ${CATS[g.category] || ''}` })),
    h('div', null, h('div', { class: 'label', text: 'How to build it' }), h('div', { class: 'formation', lang: 'ja' }, g.formation.map(f => h('div', { text: f })))),
    h('p', { text: g.explanation }),
    h('div', { style: 'display:grid;gap:10px' }, h('div', { class: 'label', text: 'Examples' }), g.examples.map(ex => h('div', { class: 'ex' }, jpInto(h('div', { class: 'jp', lang: 'ja' }), ex.ja), h('div', { class: 'en', text: ex.en })))));
  if (g.seeAlso && g.seeAlso.length) {
    el.append(h('div', { class: 'chips' }, h('span', { class: 'muted tiny', text: 'Compare with' }), g.seeAlso.map(p => {
      const t = findGrammar(p);
      return t && t !== g ? grammarChip(t) : h('button', { class: 'chip', lang: 'ja', text: p, onclick: () => { GR.open = null; $('#gramQ').value = p; renderGrammar(); } });
    })));
  }
  return el;
}
function grammarItem(g, why) {
  return h('button', { class: 'gitem', onclick: () => { GR.open = g.id; renderGrammar(); } },
    h('span', { class: 'gpat', lang: 'ja', text: g.pattern }), h('span', { class: 'gmean', text: g.meaning }), why ? h('span', { class: 'why', text: why }) : null, h('span', { class: 'gsrc', text: g._tag }));
}
function renderGrammar() {
  const out = $('#gramOut');
  if (!G.length) { out.replaceChildren(h('div', { class: 'status', style: 'padding-top:14px' }, h('span', { class: 'spin' }), 'Loading the grammar reference…')); return; }
  if (GR.open && GBY.has(GR.open)) { out.replaceChildren(grammarDetail(GBY.get(GR.open))); out.scrollTop = 0; return; }
  const q = $('#gramQ').value.trim();
  let list = G.filter(g => (!GR.src || g.source === GR.src) && (!GR.lesson || String(g.lesson) === GR.lesson) && (!GR.cat || g.category === GR.cat));
  if (q) list = list.map(g => [scoreGrammar(g, q), g]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(x => x[1]);
  const nodes = [];
  if (q && !JP_RE.test(q) && q.length >= 3) {
    if (GR.ai && GR.ai.q === q) nodes.push(GR.ai.el);
    else nodes.push(h('div', { style: 'padding-top:10px' }, h('button', { class: 'link', text: `Ask Claude which structure says “${q}”`, onclick: () => askGrammar(q) })));
  }
  nodes.push(h('div', { class: 'sechead', text: q ? `${list.length} match${list.length === 1 ? '' : 'es'}` : `${list.length} structures, in textbook order` }));
  if (!list.length) nodes.push(h('div', { class: 'empty', text: 'No match. Try the Japanese pattern, its rōmaji, or the English idea (“because”, “even if”, “have to”).' }));
  for (const g of list) nodes.push(grammarItem(g));
  out.replaceChildren(...nodes);
  out.scrollTop = 0;
}
async function askGrammar(q) {
  const ctl = new AbortController();
  const box = h('div', { class: 'ai-answer' }, busyRow('Asking Claude…', ctl));
  GR.ai = { q, el: box }; renderGrammar();
  const index = G.map(g => `${g.id} | ${g.pattern} | ${g.meaning}`).join('\n');
  try {
    const r = await ask(`A learner of Japanese is searching a grammar reference to find out how to say something. ${LEARNER}\n\nTheir question or the English they want to express: "${q}"\n\nReference entries (id | pattern | meaning):\n${index}\n\nPick up to 5 entries that best answer it, best first. Only use ids from the list.\nReply with only JSON: {"answer":"one or two sentences that answer the question directly and name the pattern(s)","picks":[{"id":"...","why":"one sentence: why it fits, and how it differs from the other picks"}]}`, ctl.signal);
    const picks = (Array.isArray(r && r.picks) ? r.picks : []).map(p => [GBY.get(str(p.id)), str(p.why)]).filter(p => p[0]);
    box.replaceChildren(h('div', { class: 'label', text: 'Claude’s suggestion' }), h('div', { text: str(r && r.answer) || 'Here are the closest structures.' }), ...picks.map(([g, why]) => grammarItem(g, why)));
  } catch (e) {
    if (e && e.code === 'cancelled') { GR.ai = null; renderGrammar(); return; }
    box.replaceChildren(h('div', { text: aiMessage(e) }));
  }
}

// ---------- write ----------
const W = { check: null, meaning: null, items: null };
const EX_WRITE = '週末、友達と映画を見に行きました。映画はとても面白いでした。来週も映画館で行きたいと思います。';
const EX_READ = '日本に来てから、毎日日本語で日記を書くようにしています。最初は簡単な文しか書けませんでしたが、少しずつ長い文章が書けるようになってきました。';
function locate(iss, text) {
  if (!iss.quote) return null;
  if (iss.sentText) {
    const p = text.indexOf(iss.sentText);
    if (p >= 0) { const q = iss.sentText.indexOf(iss.quote); if (q >= 0) return [p + q, p + q + iss.quote.length]; }
  }
  const g = text.indexOf(iss.quote);
  return g >= 0 ? [g, g + iss.quote.length] : null;
}
function renderPreview() {
  const ta = $('#writeInput'), text = ta.value, el = $('#writePreview');
  const n = [...text.replace(/\s/g, '')].length;
  $('#writeCount').textContent = n ? `${n} character${n === 1 ? '' : 's'}` : '';
  if (!text.trim()) { el.replaceChildren(h('span', { class: 'muted', style: 'font-size:.95rem;font-family:var(--font-ui)', text: 'Your text appears here with readings, so you can catch a wrong kanji conversion.' })); return; }
  if (!TOK) { el.textContent = text; return; }
  const items = analyze(text);
  const ranges = [];
  if (W.check && W.check.issues) for (const iss of W.check.issues) { iss.range = locate(iss, text); if (iss.range) ranges.push(iss); }
  const frag = document.createDocumentFragment();
  for (const it of items) {
    if (it.type === 'nl') frag.append(h('br'));
    else if (it.type === 'punct') frag.append(it.surface);
    else {
      const w = wordEl(it);
      const iss = ranges.find(i => i.range[0] < it.end && i.range[1] > it.start);
      if (iss) { w.classList.add('iss', 'iss-' + iss.severity); w.dataset.issue = iss.n; }
      frag.append(w);
    }
  }
  el.replaceChildren(frag);
  if (W.check && W.check.issues) paintIssueStates();
}
function paintIssueStates() {
  for (const iss of W.check.issues) {
    const card = $(`#issue-${iss.n}`); if (!card) continue;
    card.classList.toggle('gone', !iss.range);
    const g = $('.gone-note', card); if (g) g.hidden = !!iss.range;
  }
}
function hanamaru() {
  const pts = []; let a = 0;
  for (; a <= Math.PI * 2 * 2.6; a += 0.15) { const r = 2 + a * 1.55; pts.push([50 + r * Math.cos(a - 1.2), 50 + r * Math.sin(a - 1.2)]); }
  const f = n => n.toFixed(1), P = (r, t) => `${f(50 + r * Math.cos(t))} ${f(50 + r * Math.sin(t))}`;
  let d = 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join(' L');
  const a0 = a - 1.2, n = 9;
  d += ' L' + P(31, a0);
  for (let i = 0; i < n; i++) d += ` Q${P(52, a0 + (i + 0.5) * 2 * Math.PI / n)} ${P(31, a0 + (i + 1) * 2 * Math.PI / n)}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Hanamaru: the flower circle a teacher draws on good work');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d); path.setAttribute('pathLength', '1');
  svg.append(path);
  return svg;
}
const SEV = { error: 'Wrong', unnatural: 'Unnatural', note: 'Polish' };
function issueCard(iss) {
  const fixSlot = h('div');
  const card = h('div', { class: 'issue', id: 'issue-' + iss.n },
    h('div', { class: 'row' }, h('span', { class: 'pill ' + iss.severity, text: SEV[iss.severity] }), h('span', { class: 'muted tiny', text: iss.category }),
      h('span', { class: 'gone-note muted tiny', hidden: true, text: '· no longer in your text. Check again to confirm the fix.' })),
    h('div', { class: 'quote', lang: 'ja', text: iss.quote }),
    h('div', { text: iss.why }),
    iss.hint ? h('div', { class: 'hint', text: iss.hint }) : null,
    h('div', { class: 'row' },
      iss.g ? h('button', { class: 'link', onclick: () => openGrammar(iss.g.id, true) }, 'Review ', h('span', { lang: 'ja', text: iss.g.pattern.split(/\s*[\/／]\s*/)[0] })) : null,
      iss.fix || iss.fixedSentence ? h('button', { class: 'link', text: 'Show me the fix', onclick: ev => {
        ev.currentTarget.remove();
        fixSlot.append(h('div', { class: 'fix' }, iss.fix ? h('div', { class: 'jp', lang: 'ja', text: iss.fix }) : null, iss.fixedSentence ? jpInto(h('div', { class: 'jp', lang: 'ja' }), iss.fixedSentence) : null));
      } }) : null),
    fixSlot);
  card.addEventListener('mouseenter', () => $$(`.w[data-issue="${iss.n}"]`).forEach(w => w.classList.add('flash')));
  card.addEventListener('mouseleave', () => $$(`.w[data-issue="${iss.n}"]`).forEach(w => w.classList.remove('flash')));
  return card;
}
function renderCheck() {
  const out = $('#checkOut'), c = W.check;
  if (!c) { out.replaceChildren(); return; }
  if (c.status === 'loading') { out.replaceChildren(h('div', { class: 'panel' }, busyRow('Reading your text…', c.ctl))); return; }
  if (c.status === 'error') { out.replaceChildren(c.msg ? h('div', { class: 'panel' }, h('div', { text: c.msg })) : ''); return; }
  const panel = h('div', { class: 'panel' });
  if (!c.issues.length) {
    panel.append(h('div', { class: 'hanamaru' }, hanamaru(), h('div', null, h('h2', { lang: 'ja', text: 'よくできました' }), h('div', { text: c.overall || 'Nothing to fix. This reads as natural Japanese.' }))));
  } else {
    const n = c.issues.length;
    panel.append(h('div', null, h('h2', { text: `${n} thing${n === 1 ? '' : 's'} to look at` }), c.overall ? h('div', { class: 'muted', text: c.overall }) : null,
      h('div', { class: 'muted tiny', text: 'Each one is underlined above. Try fixing it from the hint before you open the answer.' })));
    for (const iss of c.issues) panel.append(issueCard(iss));
  }
  out.replaceChildren(panel);
  paintIssueStates();
}
const numbered = sents => sents.map((s, i) => `[${i}] ${s.text}`).join('\n');
async function runCheck() {
  const text = $('#writeInput').value;
  const sents = splitSentences(text);
  if (!sents.length) { $('#writeInput').focus(); return; }
  if (W.check && W.check.ctl) W.check.ctl.abort();
  const ctl = new AbortController(), intent = $('#intentInput').value.trim();
  W.check = { status: 'loading', ctl }; renderCheck(); renderPreview();
  const prompt = `You are marking a Japanese learner's writing. ${LEARNER} They want to learn by fixing their own mistakes.

Their text, split into numbered sentences:
${numbered(sents)}
${intent ? `\nWhat they say they meant, in English:\n${intent}\n` : ''}
Find every place where the Japanese is ungrammatical, uses the wrong particle, conjugation, word, kanji or politeness level, is unnatural enough that a native reader would stumble, or does not make sense${intent ? ', and every place where it says something different from what they meant' : ''}. Do not flag correct, natural Japanese merely because another phrasing exists. Do not invent problems: a clean text gets an empty list.

Reply with only a JSON object in this shape:
{"verdict":"clean"|"minor"|"needs work","overall":"one or two honest sentences in English about the text as a whole","issues":[{"sentence":0,"quote":"the shortest exact substring of that sentence that is wrong, copied character for character (if something is missing, quote the word just before the gap)","severity":"error"|"unnatural"|"note","category":"particle"|"conjugation"|"word choice"|"word order"|"kanji or spelling"|"politeness"|"meaning"|"missing word"|"other","why":"1-2 sentences in English on what is wrong and why, WITHOUT writing the corrected Japanese","hint":"a short nudge or question that helps them find the fix themselves, without giving the answer","fix":"the corrected replacement for the quote","fixedSentence":"the whole sentence with the smallest correction applied","grammar":"the grammar pattern involved in dictionary style such as 〜たり〜たりする, or null"}]}
severity: "error" = wrong; "unnatural" = understandable but a native speaker would not say it; "note" = optional polish. List issues in order of position.`;
  try {
    const r = await ask(prompt, ctl.signal);
    const issues = (Array.isArray(r && r.issues) ? r.issues : []).map((x, n) => {
      const s = sents[Number(x.sentence)];
      const sev = ['error', 'unnatural', 'note'].includes(x.severity) ? x.severity : 'error';
      return { n, quote: str(x.quote), sentText: s ? s.text : '', severity: sev, category: str(x.category) || 'other', why: str(x.why), hint: str(x.hint), fix: str(x.fix), fixedSentence: str(x.fixedSentence), g: findGrammar(str(x.grammar)) };
    }).filter(x => x.quote && x.why);
    W.check = { status: 'done', issues, overall: str(r && r.overall) };
  } catch (e) {
    W.check = { status: 'error', msg: aiMessage(e) };
  }
  renderCheck(); renderPreview();
}
function renderMeaning() {
  const out = $('#meaningOut'), m = W.meaning;
  if (!m) { out.replaceChildren(); return; }
  if (m.status === 'loading') { out.replaceChildren(h('div', { class: 'panel' }, busyRow('Working out what it says…', m.ctl))); return; }
  if (m.status === 'error') { out.replaceChildren(m.msg ? h('div', { class: 'panel' }, h('div', { text: m.msg })) : ''); return; }
  const panel = h('div', { class: 'panel' }, h('div', null, h('h2', { text: 'What it says, as written' }), m.tone ? h('div', { class: 'muted tiny', text: 'Tone: ' + m.tone }) : null));
  for (const s of m.rows) panel.append(h('div', { class: 'meaning-row' }, h('div', { class: 'src', lang: 'ja', text: s.src }), h('div', { class: 'en', text: s.en }), s.note ? h('div', { class: 'flag tiny', text: s.note }) : null));
  if (m.gap || m.match) panel.append(h('div', { class: 'meaning-row' }, h('div', { class: 'label', text: 'Against what you meant' }),
    h('div', { text: (m.match === 'yes' ? 'It comes across. ' : m.match === 'mostly' ? 'Mostly there. ' : m.match === 'no' ? 'It doesn’t come across yet. ' : '') + (m.gap || '') })));
  out.replaceChildren(panel);
}
async function runMeaning() {
  const sents = splitSentences($('#writeInput').value);
  if (!sents.length) { $('#writeInput').focus(); return; }
  if (W.meaning && W.meaning.ctl) W.meaning.ctl.abort();
  const ctl = new AbortController(), intent = $('#intentInput').value.trim();
  W.meaning = { status: 'loading', ctl }; renderMeaning();
  const prompt = `A Japanese learner wrote the text below and wants to know what it actually says to a native reader, so they can judge for themselves whether their message came across.

${numbered(sents)}
${intent ? `\nWhat they say they meant, in English:\n${intent}\n` : ''}
Translate each sentence into English faithfully to what is WRITTEN, not to what the writer probably meant. Do not silently repair mistakes: where a mistake changes or blurs the meaning, translate what the sentence actually conveys (or say that it is unclear) and describe the effect in "note" in English, without writing corrected Japanese. Use null for "note" when the sentence is fine.
Reply with only JSON: {"tone":"a short phrase for the register, e.g. polite (です/ます), casual","sentences":[{"sentence":0,"en":"...","note":null}]${intent ? ',"match":"yes"|"mostly"|"no","gap":"one or two sentences on what differs from what they meant, or null"' : ''}}`;
  try {
    const r = await ask(prompt, ctl.signal);
    const rows = (Array.isArray(r && r.sentences) ? r.sentences : []).map(x => ({ src: (sents[Number(x.sentence)] || {}).text || '', en: str(x.en), note: str(x.note) })).filter(x => x.en);
    W.meaning = { status: 'done', rows, tone: str(r && r.tone), match: str(r && r.match), gap: str(r && r.gap) };
  } catch (e) {
    W.meaning = { status: 'error', msg: aiMessage(e) };
  }
  renderMeaning();
}

// ---------- read ----------
const R = { sents: [], cache: new Map() };
function sentCard(s) {
  const card = h('div', { class: 'sent' });
  s.card = card;
  paintSent(s);
  return card;
}
function paintSent(s) {
  const card = s.card, keepEn = card.classList.contains('show-en');
  const line = h('div', { class: 'jp-line', lang: 'ja' });
  for (const it of s.items) line.append(it.type === 'word' ? wordEl(it) : it.type === 'nl' ? h('br') : it.surface);
  const nodes = [line];
  const ai = s.ai;
  const enBtn = h('button', { class: 'link en-btn', text: keepEn ? 'Hide English' : 'Show English', onclick: () => {
    const on = card.classList.toggle('show-en'); enBtn.textContent = on ? 'Hide English' : 'Show English';
    if (on && !s.ai) explain(s);
  } });
  const actions = h('div', { class: 'row' });
  if (!ai) actions.append(h('button', { class: 'btn', text: 'Explain this sentence', onclick: () => explain(s) }));
  else if (ai.status === 'loading') actions.append(busyRow('Explaining…', ai.ctl));
  else if (ai.status === 'error') actions.append(h('span', { class: 'muted', text: ai.msg }), h('button', { class: 'link', text: 'Try again', onclick: () => explain(s) }));
  actions.append(h('span', { class: 'grow' }), enBtn);

  if (ai && ai.status === 'done') {
    const d = ai.data;
    nodes.push(h('div', { class: 'en-line en-only' }, h('div', { text: d.translation }), d.literal ? h('div', { class: 'lit', text: 'Word for word: ' + d.literal }) : null));
    if (d.parts.length) nodes.push(h('div', { class: 'tablewrap' }, h('table', { class: 'parts' }, h('tbody', null, d.parts.map(p =>
      h('tr', null, h('td', { lang: 'ja', text: p.text }), h('td', null, h('div', { class: 'role', text: p.role }), h('div', { class: 'en-only', text: p.en }))))))));
    if (d.grammar.length) nodes.push(h('div', { style: 'display:grid;gap:8px' }, h('div', { class: 'label', text: 'Grammar in this sentence' }), d.grammar.map(x =>
      h('div', { class: 'gnote' }, h('div', { class: 'chips' }, x.g ? grammarChip(x.g) : h('span', { class: 'chip', lang: 'ja', text: x.pattern }), x.where ? h('span', { class: 'muted', lang: 'ja', text: x.where }) : null), h('div', { text: x.note })))));
    if (d.notes) nodes.push(h('div', { class: 'muted', text: d.notes }));
  } else {
    nodes.push(h('div', { class: 'en-only muted', text: ai && ai.status === 'loading' ? 'English is on its way…' : 'English appears once this sentence has been explained.' }));
    if (s.detected.length) nodes.push(h('div', { class: 'chips' }, h('span', { class: 'muted tiny', text: 'Patterns spotted' }), s.detected.map(g => grammarChip(g, true))));
  }
  nodes.push(actions);
  card.replaceChildren(...nodes);
}
async function explain(s) {
  if (s.ai && s.ai.status === 'loading') return;
  const cached = R.cache.get(s.text);
  if (cached) { s.ai = { status: 'done', data: cached }; paintSent(s); return; }
  const ctl = new AbortController();
  s.ai = { status: 'loading', ctl }; paintSent(s);
  const context = R.sents.map(x => x.text).join('');
  const cands = s.detected.map(g => `${g.id} | ${g.pattern} | ${g.meaning}`).join('\n');
  const prompt = `Explain one Japanese sentence to a learner. ${LEARNER}

Sentence: ${s.text}
${context !== s.text ? `It comes from this passage (for context only): ${context.slice(0, 1500)}\n` : ''}${cands ? `\nAn automatic pattern matcher flagged these grammar entries as possibly present (id | pattern | meaning). Some are false alarms:\n${cands}\n` : ''}
Reply with only a JSON object:
{"translation":"natural English","literal":"a more literal rendering that keeps the Japanese order and structure visible","parts":[{"text":"a phrase-sized chunk copied exactly from the sentence; the chunks in order must cover the whole sentence","role":"its job in a few words, e.g. topic, time, object, place of action, verb (polite past), clause describing 人","en":"what this chunk means"}],"grammar":[{"id":"the id from the flagged list if that entry really is used here, otherwise null","pattern":"the pattern in dictionary style, e.g. 〜ようにする","where":"the exact substring of the sentence where it appears","note":"1-2 sentences on what it does in THIS sentence"}],"notes":"anything else worth knowing (dropped subject, nuance, register), or null"}
Include every grammar point above beginner particles that a learner at this level would want explained, whether or not it was flagged. Leave out flagged entries that are not actually used.`;
  try {
    const r = await ask(prompt, ctl.signal);
    const data = {
      translation: str(r && r.translation), literal: str(r && r.literal), notes: str(r && r.notes),
      parts: (Array.isArray(r && r.parts) ? r.parts : []).map(p => ({ text: str(p.text), role: str(p.role), en: str(p.en) })).filter(p => p.text),
      grammar: (Array.isArray(r && r.grammar) ? r.grammar : []).map(x => ({ g: GBY.get(str(x.id)) || findGrammar(str(x.pattern)), pattern: str(x.pattern), where: str(x.where), note: str(x.note) })).filter(x => x.pattern || x.g),
    };
    if (!data.translation) throw { code: 'invalid_json' };
    R.cache.set(s.text, data);
    s.ai = { status: 'done', data };
  } catch (e) {
    s.ai = e && e.code === 'cancelled' ? null : { status: 'error', msg: aiMessage(e) };
  }
  paintSent(s);
}
function runAnalyze() {
  const out = $('#readOut'), text = $('#readInput').value;
  for (const s of R.sents) if (s.ai && s.ai.ctl) s.ai.ctl.abort();
  if (!text.trim()) { R.sents = []; out.replaceChildren(h('div', { class: 'muted', text: 'Paste some Japanese above, then break it down.' })); return; }
  if (!TOK) { out.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spin' }), 'Loading the readings engine…')); tokReady.then(runAnalyze, () => {}); return; }
  R.sents = splitSentences(text).map(s => ({ text: s.text, items: analyze(s.text), detected: detectGrammar(s.text), ai: R.cache.has(s.text) ? { status: 'done', data: R.cache.get(s.text) } : null }));
  out.replaceChildren(...R.sents.map(sentCard));
}
async function explainAll() {
  if (!R.sents.length) runAnalyze();
  const todo = R.sents.filter(s => !s.ai || s.ai.status === 'error');
  let i = 0;
  const worker = async () => { while (i < todo.length) { const s = todo[i++]; await explain(s); if (s.ai && s.ai.status === 'error') { i = todo.length; } } };
  await Promise.all([worker(), worker()]);
}

// ---------- wiring ----------
function rerenderAll() {
  renderPreview();
  for (const s of R.sents) if (s.card) paintSent(s);
  if (NAV.ref === 'dict') runDict(); else renderGrammar();
}
function wordClick(ev) {
  const w = ev.target.closest('.w'); if (!w || !w._g) return;
  if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
  if (ev.type === 'keydown') ev.preventDefault();
  $$('.w.sel').forEach(x => x.classList.remove('sel'));
  w.classList.add('sel');
  lookupWord(w._g);
}
function init() {
  applySettings();
  for (const [id, key] of [['setFuri', 'furi'], ['setSkip', 'skip'], ['setScript', 'script'], ['setFont', 'font'], ['setSize', 'size']]) {
    const el = $('#' + id); el.value = String(S[key]);
    el.addEventListener('change', () => { S[key] = key === 'skip' ? Number(el.value) : el.value; store.set('settings', S); applySettings(); rerenderAll(); });
  }
  const known = $('#setKnown'); known.value = S.known;
  known.addEventListener('input', debounce(() => { S.known = [...new Set([...known.value].filter(c => KANJI_RE.test(c)))].join(''); store.set('settings', S); applySettings(); rerenderAll(); }, 400));
  $('#furiBtn').addEventListener('click', ev => { const p = $('#furiPanel'); p.hidden = !p.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!p.hidden)); });

  for (const b of $$('[data-main]')) b.addEventListener('click', () => setMain(b.dataset.main));
  for (const b of $$('[data-ref]')) b.addEventListener('click', () => setRef(b.dataset.ref, false));
  $('#backBtn').addEventListener('click', () => setMain(NAV.main));
  window.addEventListener('hashchange', () => { fromHash(); paintNav(); });

  // write
  const wi = $('#writeInput'), savedW = store.get('write', null);
  wi.value = savedW == null ? EX_WRITE : savedW;
  $('#writeExample').hidden = wi.value !== EX_WRITE;
  $('#intentInput').value = store.get('intent', '');
  if ($('#intentInput').value) $('#intentBox').open = true;
  const onWrite = debounce(() => { store.set('write', wi.value); renderPreview(); }, 250);
  wi.addEventListener('input', () => { $('#writeExample').hidden = true; onWrite(); });
  wi.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); runCheck(); } });
  $('#intentInput').addEventListener('input', debounce(() => store.set('intent', $('#intentInput').value), 400));
  $('#writeClear').addEventListener('click', () => { wi.value = ''; store.set('write', ''); $('#writeExample').hidden = true; W.check = W.meaning = null; renderCheck(); renderMeaning(); renderPreview(); wi.focus(); });
  $('#btnCheck').addEventListener('click', runCheck);
  $('#btnMeaning').addEventListener('click', runMeaning);
  for (const id of ['writePreview', 'readOut']) { $('#' + id).addEventListener('click', wordClick); $('#' + id).addEventListener('keydown', wordClick); }
  $('#writePreview').addEventListener('click', ev => { const w = ev.target.closest('.w[data-issue]'); if (w) { const c = $('#issue-' + w.dataset.issue); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });

  // read
  const ri = $('#readInput'), savedR = store.get('read', null);
  ri.value = savedR == null ? EX_READ : savedR;
  $('#readExample').hidden = ri.value !== EX_READ;
  ri.addEventListener('input', debounce(() => { store.set('read', ri.value); $('#readExample').hidden = true; }, 300));
  $('#readClear').addEventListener('click', () => { ri.value = ''; store.set('read', ''); $('#readExample').hidden = true; runAnalyze(); ri.focus(); });
  $('#btnAnalyze').addEventListener('click', runAnalyze);
  $('#btnExplainAll').addEventListener('click', explainAll);
  $('#enToggle').addEventListener('change', ev => $('#readOut').classList.toggle('show-en', ev.target.checked));

  // dictionary
  $('#dictQ').addEventListener('input', debounce(runDict, 220));
  for (const b of $$('#dictDir button')) b.addEventListener('click', () => { D.dir = b.dataset.dir; $$('#dictDir button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); runDict(); });

  // grammar
  $('#gramQ').addEventListener('input', debounce(() => { GR.open = null; renderGrammar(); }, 180));
  const lessonSel = $('#gramLesson');
  const fillLessons = () => {
    lessonSel.replaceChildren(h('option', { value: '', text: GR.src ? (GR.src === 'Tobira' ? 'Any chapter' : 'Any lesson') : 'Any lesson' }));
    if (GR.src) for (const n of [...new Set(G.filter(g => g.source === GR.src).map(g => g.lesson))].sort((a, b) => a - b)) lessonSel.append(h('option', { value: String(n), text: (GR.src === 'Tobira' ? 'Chapter ' : 'Lesson ') + n }));
    lessonSel.disabled = !GR.src;
  };
  for (const b of $$('#gramSrc button')) b.addEventListener('click', () => { GR.src = b.dataset.src; GR.lesson = ''; GR.open = null; $$('#gramSrc button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); fillLessons(); renderGrammar(); });
  lessonSel.addEventListener('change', () => { GR.lesson = lessonSel.value; GR.open = null; renderGrammar(); });
  $('#gramCat').addEventListener('change', ev => { GR.cat = ev.target.value; GR.open = null; renderGrammar(); });
  fillLessons();

  fromHash(); paintNav();
  renderPreview(); renderGrammar(); runAnalyze();

  // data
  const eng = $('#engineStatus');
  eng.textContent = 'Loading the readings engine (23 MB, cached after the first visit)…';
  tokReady.then(() => { eng.textContent = ''; rerenderAll(); runAnalyze(); }, () => { eng.textContent = 'The readings engine didn’t load. Reload the page to try again.'; });
  fetchJSON('data/kanji.json').then(k => { KANJI = k; if (S.skip) rerenderAll(); }).catch(() => {});
  fetchJSON('data/grammar.json').then(list => { prepGrammar(list); fillLessons(); renderGrammar(); if (TOK) runAnalyze(); }).catch(() => { $('#gramOut').replaceChildren(h('div', { class: 'empty', text: 'The grammar reference didn’t load. Reload the page to try again.' })); });
  loadDict().then(() => { if (NAV.ref === 'dict') runDict(); const c = navigator.connection; if (!narrow() && !(c && c.saveData)) setTimeout(() => loadFull().catch(() => {}), 2500); }).catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
