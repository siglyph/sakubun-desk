import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import { useSettings } from '../settings.jsx';
import { Busy, GrammarChip, Ruby } from '../components/Japanese.jsx';

/** The conjugation chain of a word: 食べる ichidan → まし polite → た past. */
function Steps({ word }) {
  return (
    <div className="steps">
      <b lang="ja">{word.base}</b>{word.vtype && <span className="muted">{word.vtype}</span>}
      {word.steps.map((s, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span className="arrow">→</span>
          {typeof s === 'string' ? <span>{s}</span> : <span><b lang="ja">{s.jp}</b>{s.label ? ' ' + s.label : ''}</span>}
        </span>
      ))}
    </div>
  );
}

function KanjiCard({ k }) {
  return (
    <div className="kcard">
      <div className="big" lang="ja">{k.literal}</div>
      <div><div className="k">Meaning</div><div>{k.meaning || '—'}</div></div>
      <div><div className="k">On reading</div><div lang="ja">{k.on || '—'}</div></div>
      <div><div className="k">Kun reading</div><div lang="ja">{k.kun || '—'}</div></div>
      <div className="muted tiny">{k.strokes} strokes · {k.grade}{k.jlpt ? ' · JLPT ' + k.jlpt : ''}</div>
    </div>
  );
}

function Entry({ entry }) {
  const { showReading, settings } = useSettings();
  const [openKanji, setOpenKanji] = useState(null);
  const { kanji, kana } = entry;
  const alts = kanji.slice(1).concat(kana.slice(1));
  let lastPos = '';
  return (
    <div className="entry">
      <div className="entry-head">
        <span className="hw" lang="ja"><Ruby parts={entry.head} word={kanji[0] || kana[0]} /></span>
        {kanji.length > 0 && <span className="alt" lang="ja">{kana[0]}{settings.script === 'romaji' ? ' · ' + showReading(kana[0]) : ''}</span>}
        {entry.common && <span className="badge">common</span>}
      </div>
      {alts.length > 0 && <div className="alt" lang="ja">Also: {alts.slice(0, 6).join('、')}</div>}
      <ol className="senses">
        {entry.senses.map((s, i) => {
          const pos = s.pos.join(', ');
          const showPos = pos && pos !== lastPos;
          lastPos = pos;
          const extra = s.misc.concat(s.note ? [s.note] : []);
          return <li key={i}>{showPos && <span className="postag">{pos}</span>}{s.gloss}{extra.length > 0 && <span className="misc">{extra.join(' · ')}</span>}</li>;
        })}
      </ol>
      {entry.kanjiInfo.length > 0 && (
        <>
          <div className="kanji-row"><span className="muted tiny">Kanji</span>
            {entry.kanjiInfo.map(k => (
              <button key={k.literal} className="kbtn" lang="ja" aria-expanded={openKanji === k.literal}
                onClick={() => setOpenKanji(openKanji === k.literal ? null : k.literal)}>{k.literal}</button>
            ))}
          </div>
          {entry.kanjiInfo.filter(k => k.literal === openKanji).map(k => <KanjiCard key={k.literal} k={k} />)}
        </>
      )}
    </div>
  );
}

/** What the tapped word is doing in the text, shown above its dictionary entries. */
function Context({ word, onOpenGrammar }) {
  const { showReading } = useSettings();
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    setNotes([]);
    api.get('/api/grammar/for-word', { base: word.base, surface: word.s }).then(r => setNotes(r.items)).catch(() => {});
  }, [word.base, word.s]);
  const read = word.reading && word.reading !== word.s;
  return (
    <div className="ctx">
      <div className="muted tiny">In your text</div>
      <div className="jp" lang="ja"><Ruby parts={word.parts} word={word.s} /></div>
      <div className="tiny">{word.label}{read && <> · read <span lang="ja">{showReading(word.reading)}</span></>}</div>
      {word.steps.length > 0 && <Steps word={word} />}
      {notes.length > 0 && <div className="chips"><span className="muted tiny">Grammar notes</span>{notes.map(g => <GrammarChip key={g.id} entry={g} onOpen={onOpenGrammar} />)}</div>}
    </div>
  );
}

export default function DictionaryPane({ lookup, onOpenGrammar }) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('auto');
  const [word, setWord] = useState(null);            // the word tapped in a text, while the query still matches it
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const body = useRef(null);

  // A word tapped in the Write or Read view arrives here.
  useEffect(() => {
    if (!lookup) return;
    setWord(lookup.word); setQuery(lookup.word.base); setDirection('auto');
  }, [lookup]);

  const q = useDebounced(query.trim(), 200);
  const ctx = word && word.base === q ? word : null;
  useEffect(() => {
    if (!q) { setResult(null); setError(''); return; }
    const c = new AbortController();
    setLoading(true); setError('');
    api.get('/api/dict/search', { q, dir: direction, cls: ctx?.cls, base: ctx?.base }, c.signal)
      .then(r => { setResult(r); setLoading(false); if (body.current) body.current.scrollTop = 0; })
      .catch(e => { if (e.code !== 'cancelled') { setError(e.message); setLoading(false); } });
    return () => c.abort();
  }, [q, direction, ctx]);

  return (
    <div className="refpane">
      <div className="refsearch">
        <input type="search" placeholder="Search: 食べる, たべる, taberu, eat" aria-label="Search the dictionary" autoComplete="off" autoCorrect="off"
          autoCapitalize="off" spellCheck={false} value={query} onChange={e => setQuery(e.target.value)} />
        <div className="seg" role="group" aria-label="Search direction">
          {[['auto', 'Auto'], ['je', '日 → English'], ['ej', 'English → 日']].map(([d, label]) =>
            <button key={d} aria-pressed={direction === d} onClick={() => setDirection(d)}>{label}</button>)}
        </div>
      </div>
      <div className="refbody" ref={body}>
        {ctx && <Context word={ctx} onOpenGrammar={onOpenGrammar} />}
        {!q && (
          <div className="empty"><div>Look a word up in either direction. Type Japanese, kana, rōmaji or English.</div>
            <div className="tiny">Nothing here pastes into your writing. Type the word yourself; that’s part of the practice.</div></div>
        )}
        {error && <div className="empty">{error}</div>}
        {q && !result && loading && <div style={{ paddingTop: 14 }}><Busy label="Searching…" /></div>}
        {q && result && result.groups.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="sechead">{g.title}</div>}
            {g.word?.steps.length > 0 && <div style={{ paddingTop: 6 }}><Steps word={g.word} /></div>}
            {g.entries.map(e => <Entry key={e.id} entry={e} />)}
          </div>
        ))}
        {q && result && result.total === 0 && !loading && <div className="empty">Nothing found for “{q}”.</div>}
      </div>
    </div>
  );
}
