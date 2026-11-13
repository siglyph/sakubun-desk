import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, store } from '../api.js';
import { Busy, Hanamaru, JpLine, Word } from '../components/Japanese.jsx';

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
  const [text, setText] = useState(() => store.get('write', ''));
  const [intent, setIntent] = useState(() => store.get('intent', ''));
  // One box, two states: 'edit' is the textarea; 'read' shows the same text with readings and underlines.
  const [mode, setMode] = useState('edit');
  const [items, setItems] = useState(null);          // analysis of `text`, fetched when entering read-back
  const [check, setCheck] = useState(null);          // { status: 'loading' | 'done' | 'error', … }
  const [meaning, setMeaning] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const ctl = useRef({});
  const input = useRef(null);

  useEffect(() => { store.set('write', text); }, [text]);
  useEffect(() => { store.set('intent', intent); }, [intent]);
  // The textarea grows with what is written instead of scrolling inside itself.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [text, mode]);

  const issues = check?.status === 'done' ? check.issues : [];
  const ranges = useMemo(() => issues.map(i => ({ issue: i, range: locate(i, text) })), [issues, text]);

  async function readBack() {
    if (!text.trim()) { input.current?.focus(); return; }
    try {
      setItems((await api.post('/api/analyze', { text })).items);
      setSelected(null);
      setMode('read');
    } catch { /* stay in the editor; the offline note in the header explains */ }
  }
  function edit() {
    setMode('edit');
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }

  async function run(kind, setState) {
    if (!text.trim()) { input.current?.focus(); return null; }
    ctl.current[kind]?.abort();
    const c = (ctl.current[kind] = new AbortController());
    setState({ status: 'loading' });
    try {
      const r = await api.post('/api/ai/' + kind, { text, intent: intent.trim() }, c.signal);
      setState({ status: 'done', ...r });
      return r;
    } catch (e) {
      setState(e.code === 'cancelled' ? null : { status: 'error', message: e.message });
      return null;
    }
  }
  async function runCheck() {
    const r = await run('check', setCheck);
    if (r?.issues.length) readBack();                // flip to read-back so the underlines are visible
  }
  const runMeaning = () => run('meaning', setMeaning);

  const count = [...text.replace(/\s/g, '')].length;
  const pick = (item, issue) => {
    setSelected(item.start);
    if (issue) document.getElementById('issue-' + issue.n)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onLookup(item);
  };

  return (
    <section className="view" aria-label="Write">
      {mode === 'edit' ? (
        <textarea className="sheet" ref={input} lang="ja" placeholder="ここに日本語で書いてください。" aria-label="Your Japanese text"
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCheck(); } }} />
      ) : (
        // Clicking the empty part of the sheet goes back to typing; clicking a word looks it up.
        <div className="sheet readback" lang="ja" aria-label="Your text with readings" onClick={e => { if (e.target === e.currentTarget) edit(); }}>
          {items.map((it, i) => {
            if (it.t === 'n') return <br key={i} />;
            if (it.t === 'p') return <span key={i}>{it.s}</span>;
            const hit = ranges.find(r => r.range && r.range[0] < it.end && r.range[1] > it.start);
            return <Word key={i} item={it} onPick={pick} selected={selected === it.start} issue={hit && { ...hit.issue, flash: hovered === hit.issue.n }} />;
          })}
        </div>
      )}

      <input className="intent" type="text" placeholder="What you meant, in English (optional; the checker compares)" aria-label="What you meant to say, in English"
        autoComplete="off" value={intent} onChange={e => setIntent(e.target.value)} />

      <div className="row">
        <span className="muted tiny">{count ? `${count} character${count === 1 ? '' : 's'}` : ''}</span><span className="grow" />
        {mode === 'edit'
          ? <button className="btn" onClick={readBack} disabled={!text.trim()} title="Show your text with furigana">Read back</button>
          : <button className="btn" onClick={edit}>Edit</button>}
        <button className="btn" onClick={runMeaning} disabled={!text.trim()} title="See how your Japanese reads in English">What does this say?</button>
        <button className="btn primary" onClick={runCheck} disabled={!text.trim()} title="Ctrl/⌘ + Enter">Check</button>
      </div>
      {!aiEnabled && <div className="muted tiny">Checks and translations need an Anthropic API key on the server (see the README). Furigana, the dictionary and the grammar reference work without one.</div>}

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
