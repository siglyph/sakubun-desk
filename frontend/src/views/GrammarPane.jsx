import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import { JP_RE } from '../jp.js';
import { Busy, GrammarChip, JpItems } from '../components/Japanese.jsx';

function Item({ entry, why, onOpen }) {
  return (
    <button className="gitem" onClick={() => onOpen(entry.id)}>
      <span className="gpat" lang="ja">{entry.pattern}</span><span className="gmean">{entry.meaning}</span>
      {why && <span className="why">{why}</span>}<span className="gsrc">{entry.tag}</span>
    </button>
  );
}

function Detail({ id, onBack, onOpen, onSearch }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setEntry(null); setError('');
    const c = new AbortController();
    api.get('/api/grammar/entry/' + encodeURIComponent(id), {}, c.signal).then(setEntry).catch(e => { if (e.code !== 'cancelled') setError(e.message); });
    return () => c.abort();
  }, [id]);
  return (
    <div className="gdetail">
      <div><button className="link" onClick={onBack}>← All results</button></div>
      {error && <div className="muted">{error}</div>}
      {!entry && !error && <Busy label="Loading…" />}
      {entry && (
        <>
          <div><h2 lang="ja">{entry.pattern}</h2><div>{entry.meaning}</div><div className="gsrc">{entry.where} · {entry.categoryLabel}</div></div>
          <div><div className="label">How to build it</div><div className="formation" lang="ja">{entry.formation.map((f, i) => <div key={i}>{f}</div>)}</div></div>
          <p>{entry.explanation}</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="label">Examples</div>
            {entry.examples.map((ex, i) => <div className="ex" key={i}><div className="jp" lang="ja"><JpItems items={ex.items} /></div><div className="en">{ex.en}</div></div>)}
          </div>
          {entry.seeAlso.length > 0 && (
            <div className="chips"><span className="muted tiny">Compare with</span>
              {entry.seeAlso.map((s, i) => s.entry
                ? <GrammarChip key={i} entry={s.entry} onOpen={onOpen} />
                : <button key={i} className="chip" lang="ja" onClick={() => onSearch(s.pattern)}>{s.pattern}</button>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function GrammarPane({ openRequest }) {
  const [meta, setMeta] = useState(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [lesson, setLesson] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [answer, setAnswer] = useState(null);        // { q, status, answer, picks | message }
  const [error, setError] = useState('');
  const asking = useRef(null);
  const body = useRef(null);

  useEffect(() => { api.get('/api/grammar/meta').then(setMeta).catch(e => setError(e.message)); }, []);
  // A pattern opened from a text (chip, "Review …" link) arrives here.
  useEffect(() => { if (openRequest) setOpenId(openRequest.id); }, [openRequest]);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [openId]);

  const q = useDebounced(query.trim(), 180);
  useEffect(() => {
    const c = new AbortController();
    api.get('/api/grammar', { q, source, lesson, category }, c.signal).then(r => { setItems(r.items); setError(''); })
      .catch(e => { if (e.code !== 'cancelled') setError(e.message); });
    return () => c.abort();
  }, [q, source, lesson, category]);

  async function ask() {
    const c = (asking.current = new AbortController());
    setAnswer({ q, status: 'loading' });
    try {
      setAnswer({ q, status: 'done', ...(await api.post('/api/ai/grammar', { question: q }, c.signal)) });
    } catch (e) {
      setAnswer(e.code === 'cancelled' ? null : { q, status: 'error', message: e.message });
    }
  }
  const search = text => { setOpenId(null); setQuery(text); };
  const unit = source === 'Tobira' ? 'chapter' : 'lesson';

  return (
    <div className="refpane">
      <div className="refsearch">
        <input type="search" placeholder="Search: たり, tari, “or”, “have to”, te-form" aria-label="Search grammar" autoComplete="off" autoCorrect="off"
          autoCapitalize="off" spellCheck={false} value={query} onChange={e => search(e.target.value)} />
        <div className="seg" role="group" aria-label="Textbook">
          {['', ...(meta?.sources || [])].map(s =>
            <button key={s} aria-pressed={source === s} onClick={() => { setSource(s); setLesson(''); setOpenId(null); }}>{s || 'All'}</button>)}
        </div>
        <div className="row">
          <select aria-label="Lesson or chapter" value={lesson} disabled={!source} onChange={e => { setLesson(e.target.value); setOpenId(null); }}>
            <option value="">Any {unit}</option>
            {(meta?.lessons[source] || []).map(n => <option key={n} value={n}>{unit[0].toUpperCase() + unit.slice(1)} {n}</option>)}
          </select>
          <select aria-label="What it expresses" value={category} onChange={e => { setCategory(e.target.value); setOpenId(null); }}>
            <option value="">Any function</option>
            {(meta?.categories || []).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="refbody" ref={body}>
        {openId ? <Detail id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} onSearch={search} /> : (
          <>
            {error && <div className="empty">{error}</div>}
            {q.length >= 3 && !JP_RE.test(q) && (
              answer?.q === q ? (
                <div className="ai-answer">
                  {answer.status === 'loading' && <Busy label="Asking Claude…" onStop={() => asking.current?.abort()} />}
                  {answer.status === 'error' && <div>{answer.message}</div>}
                  {answer.status === 'done' && <>
                    <div className="label">Claude’s suggestion</div><div>{answer.answer || 'Here are the closest structures.'}</div>
                    {answer.picks.map(p => <Item key={p.id} entry={p} why={p.why} onOpen={setOpenId} />)}
                  </>}
                </div>
              ) : <div style={{ paddingTop: 10 }}><button className="link" onClick={ask}>Ask Claude which structure says “{q}”</button></div>
            )}
            {!items && !error && <div style={{ paddingTop: 14 }}><Busy label="Loading the grammar reference…" /></div>}
            {items && <div className="sechead">{q ? `${items.length} match${items.length === 1 ? '' : 'es'}` : `${items.length} structures, in textbook order`}</div>}
            {items?.length === 0 && <div className="empty">No match. Try the Japanese pattern, its rōmaji, or the English idea (“because”, “even if”, “have to”).</div>}
            {items?.map(g => <Item key={g.id} entry={g} onOpen={setOpenId} />)}
          </>
        )}
      </div>
    </div>
  );
}
