import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, store } from '../api.js';
import { Busy, GrammarChip, Word } from '../components/Japanese.jsx';

// How English is revealed: never until asked, only after you have written your own guess, or straight away.
const ENGLISH_MODES = [['hidden', 'Hidden'], ['guess', 'Guess first'], ['shown', 'Shown']];
const VERDICT = { right: 'Right', close: 'Close', off: 'Off' };

function Sentence({ sentence, ai, englishMode, selected, onPick, onExplain, onStop, onOpenGrammar }) {
  const [showEnglish, setShowEnglish] = useState(false);   // the per-sentence toggle used in "Hidden" mode
  const [guess, setGuess] = useState('');
  const data = ai?.status === 'done' ? ai.data : null;
  const loading = ai?.status === 'loading';
  const english = englishMode === 'shown' || (englishMode === 'guess' && !!data) || showEnglish;
  const guessing = englishMode === 'guess' && !data;       // waiting for the reader's own attempt

  const toggleEnglish = () => {
    if (!showEnglish && !ai) onExplain();
    setShowEnglish(v => !v);
  };
  const submitGuess = e => { e.preventDefault(); if (guess.trim() && !loading) onExplain(guess.trim()); };

  return (
    <div className={'sent' + (english ? ' show-en' : '')}>
      <div className="jp-line" lang="ja">
        {sentence.items.map((it, i) => it.t === 'w'
          ? <Word key={i} item={it} onPick={item => onPick(item, i)} selected={selected === i} />
          : <span key={i}>{it.s}</span>)}
      </div>

      {guessing && !loading && (
        <form className="guessrow" onSubmit={submitGuess}>
          <input className="intent" type="text" placeholder="What do you think this means?" aria-label="Your guess at the English meaning"
            autoComplete="off" value={guess} onChange={e => setGuess(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!guess.trim()}>Check my guess</button>
          <button className="link" type="button" onClick={() => onExplain()}>Skip, just show me</button>
        </form>
      )}
      {loading && <Busy label={guessing && guess.trim() ? 'Checking your guess…' : 'Explaining…'} onStop={onStop} />}
      {ai?.status === 'error' && <div className="row"><span className="muted">{ai.message}</span><button className="link" onClick={() => onExplain(guessing ? guess.trim() : '')}>Try again</button></div>}

      {data ? (
        <>
          {data.guess && (
            <div className="graded">
              <div className="row"><span className={'pill ' + data.guess.verdict}>{VERDICT[data.guess.verdict] || 'Checked'}</span><span className="muted tiny">Your guess</span></div>
              <div className="yours">{data.guess.text}</div>
              <div>{data.guess.feedback}</div>
            </div>
          )}
          <div className="en-line en-only"><div>{data.translation}</div>{data.literal && <div className="lit">Word for word: {data.literal}</div>}</div>
          {data.parts.length > 0 && (
            <div className="tablewrap"><table className="parts"><tbody>
              {data.parts.map((p, i) => (
                <tr key={i}><td lang="ja">{p.text}</td><td><div className="role">{p.role}</div><div className="en-only">{p.en}</div></td></tr>
              ))}
            </tbody></table></div>
          )}
          {data.grammar.map((g, i) => (
            <div className="gnote" key={i}>
              <div className="chips">
                {g.entry ? <GrammarChip entry={g.entry} onOpen={onOpenGrammar} /> : <span className="chip" lang="ja">{g.pattern}</span>}
                {g.where && <span className="muted" lang="ja">{g.where}</span>}
              </div>
              <div>{g.note}</div>
            </div>
          ))}
          {data.notes && <div className="muted">{data.notes}</div>}
        </>
      ) : sentence.detected.length > 0 && (
        <div className="chips"><span className="muted tiny">Patterns spotted</span>
          {sentence.detected.map(g => <GrammarChip key={g.id} entry={g} maybe onOpen={onOpenGrammar} />)}</div>
      )}

      {englishMode !== 'guess' && (!ai || englishMode === 'hidden') && (
        <div className="row">
          {!ai && <button className="btn" onClick={() => onExplain()}>Explain</button>}
          <span className="grow" />
          {englishMode === 'hidden' && <button className="link" onClick={toggleEnglish}>{showEnglish ? 'Hide English' : 'Show English'}</button>}
        </div>
      )}
    </div>
  );
}

export default function ReadView({ onLookup, onOpenGrammar, aiEnabled }) {
  const [text, setText] = useState(() => store.get('read', ''));
  // One box, two states: 'edit' is where you paste; 'read' is the sentence-by-sentence breakdown.
  const [mode, setMode] = useState('edit');
  const [sentences, setSentences] = useState([]);
  const [ai, setAi] = useState({});                  // sentence text -> { status, data | message }
  const [englishMode, setEnglishMode] = useState(() => store.get('english', 'guess'));
  const [selected, setSelected] = useState(null);    // "sentenceIndex:itemIndex"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controllers = useRef({});
  const input = useRef(null);

  useEffect(() => { store.set('read', text); }, [text]);
  useEffect(() => { store.set('english', englishMode); }, [englishMode]);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [text, mode]);

  async function breakDown() {
    if (!text.trim()) { input.current?.focus(); return; }
    setError(''); setBusy(true); setSelected(null);
    try {
      setSentences((await api.post('/api/read', { text })).sentences);
      setMode('read');
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function explain(sentence, guess = '') {
    const key = sentence.text;
    if (ai[key]?.status === 'loading' || ai[key]?.status === 'done') return ai[key];
    const c = (controllers.current[key] = new AbortController());
    setAi(a => ({ ...a, [key]: { status: 'loading' } }));
    let result;
    try {
      const data = await api.post('/api/ai/explain', { sentence: key, context: sentences.map(s => s.text).join(''), guess }, c.signal);
      result = { status: 'done', data };
    } catch (e) {
      result = e.code === 'cancelled' ? undefined : { status: 'error', message: e.message };
    }
    setAi(a => ({ ...a, [key]: result }));
    return result;
  }
  async function explainAll() {
    const todo = sentences.filter(s => !ai[s.text] || ai[s.text].status === 'error');
    let next = 0, failed = false;
    const worker = async () => {
      while (next < todo.length && !failed) {
        const r = await explain(todo[next++]);
        if (r?.status === 'error') failed = true;     // stop the queue; each sentence offers its own retry
      }
    };
    await Promise.all([worker(), worker()]);
  }

  if (mode === 'edit') {
    return (
      <section className="view" aria-label="Read">
        <textarea className="sheet" ref={input} lang="ja" placeholder="日本語の文をここに貼り付けてください。" aria-label="Japanese text to read"
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); breakDown(); } }} />
        <div className="row">
          {error && <span className="muted">{error}</span>}<span className="grow" />
          {busy && <Busy label="Breaking it down…" />}
          <button className="btn primary" onClick={breakDown} disabled={!text.trim() || busy} title="Ctrl/⌘ + Enter">Break it down</button>
        </div>
      </section>
    );
  }

  return (
    <section className="view" aria-label="Read">
      <div className="readbar">
        <button className="btn" onClick={() => setMode('edit')}>← Edit text</button>
        <span className="grow" />
        {englishMode !== 'guess' && <button className="btn" onClick={explainAll}>Explain every sentence</button>}
        <div className="seg" role="group" aria-label="English">
          <span className="muted tiny">English</span>
          {ENGLISH_MODES.map(([id, label]) => <button key={id} aria-pressed={englishMode === id} onClick={() => setEnglishMode(id)}>{label}</button>)}
        </div>
      </div>
      <div className="legend" aria-label="Underline colors">
        {[['n', 'noun'], ['v', 'verb'], ['adj', 'adjective'], ['adv', 'adverb'], ['p', 'particle'], ['aux', 'copula / auxiliary']].map(([c, name]) =>
          <span key={c}><i style={{ background: `var(--pos-${c})` }} />{name}</span>)}
      </div>
      {!aiEnabled && <div className="muted tiny">Explanations and English need an Anthropic API key on the server (see the README). The word-by-word breakdown works without one.</div>}

      <div className="pos">
        {sentences.map((s, si) => (
          <Sentence key={si + s.text} sentence={s} ai={ai[s.text]} englishMode={englishMode}
            selected={selected?.startsWith(si + ':') ? Number(selected.split(':')[1]) : null}
            onPick={(item, i) => { setSelected(si + ':' + i); onLookup(item); }}
            onExplain={guess => explain(s, guess)} onStop={() => controllers.current[s.text]?.abort()} onOpenGrammar={onOpenGrammar} />
        ))}
      </div>
    </section>
  );
}
