import { useEffect, useMemo, useRef, useState } from 'react';
import { api, store } from '../api.js';
import { useDebounced } from '../hooks.js';
import { Busy, Hanamaru, JpLine, Word } from '../components/Japanese.jsx';

const EXAMPLE = '週末、友達と映画を見に行きました。映画はとても面白いでした。来週も映画館で行きたいと思います。';
const SEVERITY = { error: 'Wrong', unnatural: 'Unnatural', note: 'Polish' };

/** Where an issue's quoted text sits in the current draft, or null once it has been edited away. */
function locate(issue, text) {
  if (issue.sentText) {
    const p = text.indexOf(issue.sentText);
    if (p >= 0) {
      const q = issue.sentText.indexOf(issue.quote);
      if (q >= 0) return [p + q, p + q + issue.quote.length];
    }
  }
  const g = text.indexOf(issue.quote);
  return g >= 0 ? [g, g + issue.quote.length] : null;
}

function IssueCard({ issue, gone, onHover, onOpenGrammar }) {
  const [showFix, setShowFix] = useState(false);
  return (
    <div className={'issue' + (gone ? ' gone' : '')} id={'issue-' + issue.n} onMouseEnter={() => onHover(issue.n)} onMouseLeave={() => onHover(null)}>
      <div className="row">
        <span className={'pill ' + issue.severity}>{SEVERITY[issue.severity] || 'Wrong'}</span>
        <span className="muted tiny">{issue.category}</span>
        {gone && <span className="muted tiny">· no longer in your text. Check again to confirm the fix.</span>}
      </div>
      <div className="quote" lang="ja">{issue.quote}</div>
      <div>{issue.why}</div>
      {issue.hint && <div className="hint">{issue.hint}</div>}
      <div className="row">
        {issue.grammar && <button className="link" onClick={() => onOpenGrammar(issue.grammar.id)}>Review <span lang="ja">{issue.grammar.short}</span></button>}
        {!showFix && (issue.fix || issue.fixedSentence) && <button className="link" onClick={() => setShowFix(true)}>Show me the fix</button>}
      </div>
      {showFix && (
        <div className="fix">
          {issue.fix && <div className="jp" lang="ja">{issue.fix}</div>}
          {issue.fixedSentence && <JpLine text={issue.fixedSentence} />}
        </div>
      )}
    </div>
  );
}

export default function WriteView({ onLookup, onOpenGrammar, aiEnabled }) {
  const [text, setText] = useState(() => store.get('write', null) ?? EXAMPLE);
  const [intent, setIntent] = useState(() => store.get('intent', ''));
  const [intentOpen] = useState(() => !!store.get('intent', ''));   // open on load only if something was saved
  const [items, setItems] = useState(null);
  const [check, setCheck] = useState(null);          // { status: 'loading' | 'done' | 'error', … }
  const [meaning, setMeaning] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const ctl = useRef({});
  const input = useRef(null);

  // Readings for the preview: re-analyzed shortly after typing stops.
  const settled = useDebounced(text, 250);
  useEffect(() => {
    store.set('write', settled);
    if (!settled.trim()) { setItems([]); return; }
    const c = new AbortController();
    api.post('/api/analyze', { text: settled }, c.signal).then(r => setItems(r.items)).catch(() => {});
    return () => c.abort();
  }, [settled]);
  useEffect(() => { store.set('intent', intent); }, [intent]);

  const issues = check?.status === 'done' ? check.issues : [];
  const ranges = useMemo(() => issues.map(i => ({ issue: i, range: locate(i, settled) })), [issues, settled]);

  async function run(kind, setState) {
    if (!text.trim()) { input.current?.focus(); return; }
    ctl.current[kind]?.abort();
    const c = (ctl.current[kind] = new AbortController());
    setState({ status: 'loading' });
    try {
      const r = await api.post('/api/ai/' + kind, { text, intent: intent.trim() }, c.signal);
      setState({ status: 'done', ...r });
    } catch (e) {
      setState(e.code === 'cancelled' ? null : { status: 'error', message: e.message });
    }
  }
  const runCheck = () => run('check', setCheck);
  const runMeaning = () => run('meaning', setMeaning);
  const clear = () => { setText(''); setCheck(null); setMeaning(null); input.current?.focus(); };

  const count = [...text.replace(/\s/g, '')].length;
  const pick = (item, issue) => {
    setSelected(item.start);
    if (issue) document.getElementById('issue-' + issue.n)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onLookup(item);
  };

  return (
    <section className="view" aria-label="Write">
      <div className="view-head"><h1><span lang="ja">書く</span><small>Write</small></h1><p>Write first. Nothing is checked or suggested until you ask.</p></div>
      {text === EXAMPLE && (
        <div className="example-note"><span>This is an example with a couple of mistakes in it, so you can try the checker. Replace it with your own writing.</span>
          <button className="link" onClick={clear}>Clear it</button></div>
      )}
      <textarea className="sheet" ref={input} lang="ja" placeholder="ここに日本語で書いてください。" aria-label="Your Japanese text"
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCheck(); } }} />
      <details className="intent" open={intentOpen || undefined}>
        <summary>Say what you meant in English (optional). The checker will compare.</summary>
        <textarea className="small" placeholder="e.g. I went to see a movie with a friend on the weekend." aria-label="What you meant to say, in English"
          value={intent} onChange={e => setIntent(e.target.value)} />
      </details>
      <div className="row">
        <span className="muted tiny">{count ? `${count} character${count === 1 ? '' : 's'}` : ''}</span><span className="grow" />
        <button className="btn" onClick={runMeaning} title="See how your Japanese reads in English">What does this say?</button>
        <button className="btn primary" onClick={runCheck} title="Ctrl/⌘ + Enter">Check my writing</button>
      </div>
      {!aiEnabled && <div className="muted tiny">Checks and translations need an Anthropic API key on the server (see the README). Readings, the dictionary and the grammar reference work without one.</div>}

      <div className="paper-label"><span className="label">As written, with readings</span></div>
      <div className="paper" lang="ja">
        {!text.trim() ? <span className="muted" style={{ fontSize: '.95rem', fontFamily: 'var(--font-ui)' }}>Your text appears here with readings, so you can catch a wrong kanji conversion.</span>
          : !items ? text
            : items.map((it, i) => {
              if (it.t === 'n') return <br key={i} />;
              if (it.t === 'p') return <span key={i}>{it.s}</span>;
              const hit = ranges.find(r => r.range && r.range[0] < it.end && r.range[1] > it.start);
              return <Word key={i} item={it} onPick={pick} selected={selected === it.start}
                issue={hit && { ...hit.issue, flash: hovered === hit.issue.n }} />;
            })}
      </div>

      {check?.status === 'loading' && <div className="panel"><Busy label="Reading your text…" onStop={() => ctl.current.check?.abort()} /></div>}
      {check?.status === 'error' && <div className="panel"><div>{check.message}</div></div>}
      {check?.status === 'done' && (
        <div className="panel">
          {issues.length === 0 ? (
            <div className="hanamaru"><Hanamaru /><div><h2 lang="ja">よくできました</h2><div>{check.overall || 'Nothing to fix. This reads as natural Japanese.'}</div></div></div>
          ) : (
            <>
              <div>
                <h2>{issues.length} thing{issues.length === 1 ? '' : 's'} to look at</h2>
                {check.overall && <div className="muted">{check.overall}</div>}
                <div className="muted tiny">Each one is underlined above. Try fixing it from the hint before you open the answer.</div>
              </div>
              {ranges.map(({ issue, range }) => <IssueCard key={issue.n} issue={issue} gone={!range} onHover={setHovered} onOpenGrammar={onOpenGrammar} />)}
            </>
          )}
        </div>
      )}

      {meaning?.status === 'loading' && <div className="panel"><Busy label="Working out what it says…" onStop={() => ctl.current.meaning?.abort()} /></div>}
      {meaning?.status === 'error' && <div className="panel"><div>{meaning.message}</div></div>}
      {meaning?.status === 'done' && (
        <div className="panel">
          <div><h2>What it says, as written</h2>{meaning.tone && <div className="muted tiny">Tone: {meaning.tone}</div>}</div>
          {meaning.rows.map((row, i) => (
            <div className="meaning-row" key={i}>
              <div className="src" lang="ja">{row.src}</div><div className="en">{row.en}</div>
              {row.note && <div className="flag tiny">{row.note}</div>}
            </div>
          ))}
          {(meaning.match || meaning.gap) && (
            <div className="meaning-row"><div className="label">Against what you meant</div>
              <div>{{ yes: 'It comes across. ', mostly: 'Mostly there. ', no: 'It doesn’t come across yet. ' }[meaning.match] || ''}{meaning.gap}</div></div>
          )}
        </div>
      )}
    </section>
  );
}
