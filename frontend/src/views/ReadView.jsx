import { useEffect, useRef, useState } from 'react';
import { api, store } from '../api.js';
import { Busy, GrammarChip, Word } from '../components/Japanese.jsx';

const EXAMPLE = '日本に来てから、毎日日本語で日記を書くようにしています。最初は簡単な文しか書けませんでしたが、少しずつ長い文章が書けるようになってきました。';

function Sentence({ sentence, ai, showAllEnglish, selected, onPick, onExplain, onStop, onOpenGrammar }) {
  const [showEnglish, setShowEnglish] = useState(false);
  const toggleEnglish = () => {
    if (!showEnglish && !ai) onExplain();
    setShowEnglish(v => !v);
  };
  const data = ai?.status === 'done' ? ai.data : null;
  return (
    <div className={'sent' + (showEnglish ? ' show-en' : '')}>
      <div className="jp-line" lang="ja">
        {sentence.items.map((it, i) => it.t === 'w'
          ? <Word key={i} item={it} onPick={item => onPick(item, i)} selected={selected === i} />
          : <span key={i}>{it.s}</span>)}
      </div>

      {data ? (
        <>
          <div className="en-line en-only"><div>{data.translation}</div>{data.literal && <div className="lit">Word for word: {data.literal}</div>}</div>
          {data.parts.length > 0 && (
            <div className="tablewrap"><table className="parts"><tbody>
              {data.parts.map((p, i) => (
                <tr key={i}><td lang="ja">{p.text}</td><td><div className="role">{p.role}</div><div className="en-only">{p.en}</div></td></tr>
              ))}
            </tbody></table></div>
          )}
          {data.grammar.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="label">Grammar in this sentence</div>
              {data.grammar.map((g, i) => (
                <div className="gnote" key={i}>
                  <div className="chips">
                    {g.entry ? <GrammarChip entry={g.entry} onOpen={onOpenGrammar} /> : <span className="chip" lang="ja">{g.pattern}</span>}
                    {g.where && <span className="muted" lang="ja">{g.where}</span>}
                  </div>
                  <div>{g.note}</div>
                </div>
              ))}
            </div>
          )}
          {data.notes && <div className="muted">{data.notes}</div>}
        </>
      ) : (
        <>
          <div className="en-only muted">{ai?.status === 'loading' ? 'English is on its way…' : 'English appears once this sentence has been explained.'}</div>
          {sentence.detected.length > 0 && (
            <div className="chips"><span className="muted tiny">Patterns spotted</span>
              {sentence.detected.map(g => <GrammarChip key={g.id} entry={g} maybe onOpen={onOpenGrammar} />)}</div>
          )}
        </>
      )}

      <div className="row">
        {!ai && <button className="btn" onClick={onExplain}>Explain this sentence</button>}
        {ai?.status === 'loading' && <Busy label="Explaining…" onStop={onStop} />}
        {ai?.status === 'error' && <><span className="muted">{ai.message}</span><button className="link" onClick={onExplain}>Try again</button></>}
        <span className="grow" />
        {!showAllEnglish && <button className="link" onClick={toggleEnglish}>{showEnglish ? 'Hide English' : 'Show English'}</button>}
      </div>
    </div>
  );
}

export default function ReadView({ onLookup, onOpenGrammar, aiEnabled }) {
  const [text, setText] = useState(() => store.get('read', null) ?? EXAMPLE);
  const [sentences, setSentences] = useState(null);
  const [ai, setAi] = useState({});                  // sentence text -> { status, data | message }
  const [showEnglish, setShowEnglish] = useState(false);
  const [selected, setSelected] = useState(null);    // "sentenceIndex:itemIndex"
  const [error, setError] = useState('');
  const controllers = useRef({});
  const input = useRef(null);

  useEffect(() => { store.set('read', text); }, [text]);

  async function breakDown(source = text) {
    setError(''); setSelected(null);
    if (!source.trim()) { setSentences([]); return; }
    try {
      setSentences((await api.post('/api/read', { text: source })).sentences);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { breakDown(); }, []);              // eslint-disable-line react-hooks/exhaustive-deps

  async function explain(sentence) {
    const key = sentence.text;
    if (ai[key]?.status === 'loading' || ai[key]?.status === 'done') return ai[key];
    const c = (controllers.current[key] = new AbortController());
    setAi(a => ({ ...a, [key]: { status: 'loading' } }));
    let result;
    try {
      const data = await api.post('/api/ai/explain', { sentence: key, context: sentences.map(s => s.text).join('') }, c.signal);
      result = { status: 'done', data };
    } catch (e) {
      result = e.code === 'cancelled' ? undefined : { status: 'error', message: e.message };
    }
    setAi(a => ({ ...a, [key]: result }));
    return result;
  }
  async function explainAll() {
    const todo = (sentences || []).filter(s => !ai[s.text] || ai[s.text].status === 'error');
    let next = 0, failed = false;
    const worker = async () => {
      while (next < todo.length && !failed) {
        const r = await explain(todo[next++]);
        if (r?.status === 'error') failed = true;     // stop the queue; each card offers its own retry
      }
    };
    await Promise.all([worker(), worker()]);
  }
  const clear = () => { setText(''); setSentences([]); input.current?.focus(); };

  return (
    <section className="view" aria-label="Read">
      <div className="view-head"><h1><span lang="ja">読む</span><small>Read</small></h1><p>Paste Japanese from anywhere. Tap any word; open the grammar it uses.</p></div>
      {text === EXAMPLE && (
        <div className="example-note"><span>Example text. Paste your own sentence, article or lyric over it.</span>
          <button className="link" onClick={clear}>Clear it</button></div>
      )}
      <textarea className="sheet" ref={input} lang="ja" placeholder="日本語の文をここに貼り付けてください。" aria-label="Japanese text to analyze"
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
      <div className="row">
        <label className="switch"><input type="checkbox" checked={showEnglish} onChange={e => setShowEnglish(e.target.checked)} /><span>Show English</span></label>
        <span className="grow" />
        <button className="btn" onClick={explainAll} disabled={!sentences?.length}>Explain every sentence</button>
        <button className="btn primary" onClick={() => breakDown()}>Break it down</button>
      </div>
      {!aiEnabled && <div className="muted tiny">Explanations and English need an Anthropic API key on the server (see the README). The word-by-word breakdown works without one.</div>}
      <div className="legend" aria-label="Underline colors">
        {[['n', 'noun'], ['v', 'verb'], ['adj', 'adjective'], ['adv', 'adverb'], ['p', 'particle'], ['aux', 'copula / auxiliary']].map(([c, name]) =>
          <span key={c}><i style={{ background: `var(--pos-${c})` }} />{name}</span>)}
      </div>

      <div id="readOut" className={'view pos' + (showEnglish ? ' show-en' : '')}>
        {error && <div className="muted">{error}</div>}
        {sentences === null && !error && <Busy label="Breaking it down…" />}
        {sentences?.length === 0 && <div className="muted">Paste some Japanese above, then break it down.</div>}
        {sentences?.map((s, si) => (
          <Sentence key={si + s.text} sentence={s} ai={ai[s.text]} showAllEnglish={showEnglish}
            selected={selected?.startsWith(si + ':') ? Number(selected.split(':')[1]) : null}
            onPick={(item, i) => { setSelected(si + ':' + i); onLookup(item); }}
            onExplain={() => explain(s)} onStop={() => controllers.current[s.text]?.abort()} onOpenGrammar={onOpenGrammar} />
        ))}
      </div>
    </section>
  );
}
