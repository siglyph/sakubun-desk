import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toRomaji } from 'wanakana';
import { api, store } from './api.js';
import { KANJI_RE, toKata } from './jp.js';

const DEFAULTS = { furi: 'always', skip: 0, known: '', script: 'hira', font: 'gothic', size: 'm' };
const SettingsContext = createContext(null);

/** Furigana and display preferences, plus the two helpers every Japanese renderer needs. */
export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...store.get('settings', {}) }));
  const [levels, setLevels] = useState({});          // kanji -> JLPT level (4 = N5 … 1 = N1)

  useEffect(() => { api.get('/api/kanji/levels').then(setLevels).catch(() => {}); }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.furi = settings.furi; root.dataset.font = settings.font; root.dataset.size = settings.size;
    store.set('settings', settings);
  }, [settings]);

  const update = useCallback((key, value) => setSettings(s => ({ ...s, [key]: value })), []);

  const value = useMemo(() => {
    const known = new Set(settings.known);
    const knows = c => c === '々' || known.has(c) || (settings.skip > 0 && levels[c] >= settings.skip);
    return {
      settings, update,
      /** Does this word contain a kanji the reader has not marked as known? */
      needsFurigana: word => [...word].some(c => KANJI_RE.test(c) && !knows(c)),
      /** A hiragana reading in the script the reader chose. */
      showReading: r => settings.script === 'kata' ? toKata(r) : settings.script === 'romaji' ? toRomaji(r) : r,
    };
  }, [settings, levels, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

export function SettingsPanel() {
  const { settings, update } = useSettings();
  const select = (key, label, options, numeric) => (
    <label className="field"><span>{label}</span>
      <select value={settings[key]} onChange={e => update(key, numeric ? Number(e.target.value) : e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
  return (
    <section className="settings" aria-label="Furigana and display settings">
      <div className="wrap">
        {select('furi', 'Show furigana', [['always', 'Always'], ['hover', 'Only when I point at or tap a word'], ['off', 'Never']])}
        {select('skip', 'For which kanji', [[0, 'Every kanji'], [4, 'Skip JLPT N5 kanji'], [3, 'Skip N5–N4 kanji'], [2, 'Skip N5–N2 kanji (N1 and rarer only)']], true)}
        <label className="field"><span>Kanji I already know</span>
          <input type="text" lang="ja" placeholder="例: 日本語学生先生" autoComplete="off" spellCheck={false} value={settings.known}
            onChange={e => update('known', [...new Set([...e.target.value].filter(c => KANJI_RE.test(c)))].join(''))} />
          <small>Words written only with these get no furigana.</small>
        </label>
        {select('script', 'Write readings in', [['hira', 'Hiragana'], ['kata', 'Katakana'], ['romaji', 'Rōmaji']])}
        {select('font', 'Japanese typeface', [['gothic', 'Gothic (screen style)'], ['mincho', 'Minchō (print style)'], ['kyokasho', 'Kyōkasho (textbook, close to handwriting)']])}
        {select('size', 'Japanese text size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}
      </div>
    </section>
  );
}
