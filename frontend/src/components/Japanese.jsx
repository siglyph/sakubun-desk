import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSettings } from '../settings.jsx';

/** [text, reading] pieces with furigana over the kanji, unless the reader knows every kanji in the word. */
export function Ruby({ parts, word }) {
  const { needsFurigana, showReading } = useSettings();
  const want = needsFurigana(word);
  return parts.map(([text, reading], i) =>
    reading && want ? <ruby key={i}>{text}<rt>{showReading(reading)}</rt></ruby> : <span key={i}>{text}</span>);
}

/** A tappable word in a text. */
export function Word({ item, onPick, selected, issue }) {
  const cls = ['w', item.cls && 'p-' + item.cls, selected && 'sel', issue && 'iss iss-' + issue.severity, issue?.flash && 'flash'].filter(Boolean).join(' ');
  const pick = () => onPick(item, issue);
  return (
    <span className={cls} role="button" tabIndex={0} onClick={pick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}>
      <Ruby parts={item.parts} word={item.s} />
    </span>
  );
}

/** Analyzed items as plain (not tappable) Japanese with readings. */
export function JpItems({ items }) {
  return items.map((it, i) => it.t === 'w' ? <Ruby key={i} parts={it.parts} word={it.s} /> : it.t === 'n' ? <br key={i} /> : <span key={i}>{it.s}</span>);
}

/** A Japanese string shown with readings; asks the server to analyze it once. */
export function JpLine({ text, className = 'jp' }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const ctl = new AbortController();
    api.post('/api/analyze', { text }, ctl.signal).then(r => setItems(r.items)).catch(() => {});
    return () => ctl.abort();
  }, [text]);
  return <div className={className} lang="ja">{items ? <JpItems items={items} /> : text}</div>;
}

export function Busy({ label, onStop }) {
  return (
    <div className="status"><span className="spin" /><span>{label}</span>
      {onStop && <button className="link" onClick={onStop}>Stop</button>}
    </div>
  );
}

/** A grammar pattern you can open in the reference. `maybe` marks an unconfirmed regex match. */
export function GrammarChip({ entry, maybe, onOpen }) {
  return (
    <button className={'chip' + (maybe ? ' maybe' : '')} lang="ja" onClick={() => onOpen(entry.id)}>
      {entry.short}<small>{entry.tag}</small>
    </button>
  );
}

/** 花丸: the flower circle a teacher draws on good work. */
export function Hanamaru() {
  const f = n => n.toFixed(1);
  const P = (r, t) => `${f(50 + r * Math.cos(t))} ${f(50 + r * Math.sin(t))}`;
  let a = 0, d = 'M';
  const pts = [];
  for (; a <= Math.PI * 2 * 2.6; a += 0.15) pts.push(P(2 + a * 1.55, a - 1.2));
  d += pts.join(' L');
  const a0 = a - 1.2, n = 9;
  d += ' L' + P(31, a0);
  for (let i = 0; i < n; i++) d += ` Q${P(52, a0 + (i + 0.5) * 2 * Math.PI / n)} ${P(31, a0 + (i + 1) * 2 * Math.PI / n)}`;
  return <svg viewBox="0 0 100 100" role="img" aria-label="Hanamaru: the flower circle a teacher draws on good work"><path d={d} pathLength="1" /></svg>;
}
