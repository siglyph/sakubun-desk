import { useCallback, useEffect, useState } from 'react';
import { api, store } from './api.js';
import { SettingsPanel, SettingsProvider } from './settings.jsx';
import WriteView from './views/WriteView.jsx';
import ReadView from './views/ReadView.jsx';
import DictionaryPane from './views/DictionaryPane.jsx';
import GrammarPane from './views/GrammarPane.jsx';

const MAIN = [['write', '書く', 'Write'], ['read', '読む', 'Read']];
const REF = [['dict', '辞書', 'Dictionary'], ['grammar', '文法', 'Grammar']];
const narrow = () => window.matchMedia('(max-width: 980px)').matches;

function fromHash() {
  const name = window.location.hash.slice(1);
  if (name === 'write' || name === 'read') return { main: name, focus: 'main' };
  if (name === 'dictionary' || name === 'grammar') return { ref: name === 'grammar' ? 'grammar' : 'dict', focus: 'ref' };
  return {};
}

export default function App() {
  // `main` is the workspace on the left, `ref` the reference pane on the right. On a phone only one
  // of the two columns shows at a time: `focus` says which, `returning` shows the "back to your text" link.
  const [nav, setNav] = useState(() => ({ main: store.get('main', 'write'), ref: store.get('ref', 'dict'), focus: 'main', returning: false, ...fromHash() }));
  const [showSettings, setShowSettings] = useState(false);
  const [lookup, setLookup] = useState(null);        // { word } tapped in a text
  const [grammarOpen, setGrammarOpen] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => { api.get('/api/status').then(setStatus).catch(() => setStatus({ offline: true })); }, []);
  useEffect(() => {
    const onHash = () => setNav(n => ({ ...n, ...fromHash() }));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.body.dataset.focus = nav.focus;
    if (nav.returning) document.body.dataset.return = '1'; else delete document.body.dataset.return;
    store.set('main', nav.main); store.set('ref', nav.ref);
    const name = nav.focus === 'ref' && narrow() ? (nav.ref === 'dict' ? 'dictionary' : 'grammar') : nav.main;
    window.history.replaceState(null, '', '#' + name);
  }, [nav]);

  const showMain = main => setNav(n => ({ ...n, main, focus: 'main', returning: false }));
  const showRef = (ref, fromText = false) => {
    setNav(n => ({ ...n, ref, focus: 'ref', returning: fromText }));
    if (narrow()) window.scrollTo(0, 0);
  };
  const lookupWord = useCallback(word => { setLookup({ word }); showRef('dict', true); }, []);
  const openGrammar = useCallback(id => { setGrammarOpen({ id }); showRef('grammar', true); }, []);
  const aiEnabled = status ? !!status.ai?.enabled : true;

  return (
    <SettingsProvider>
      <header className="top">
        <div className="wrap">
          <div className="brand"><span className="mark" lang="ja">作文</span><span className="name">Sakubun Desk</span></div>
          <nav className="tabs" aria-label="Workspace">
            {MAIN.map(([id, ja, en]) => (
              <button key={id} className="tab" aria-selected={nav.main === id} onClick={() => showMain(id)}><span className="ja" lang="ja">{ja}</span>{en}</button>
            ))}
          </nav>
          <span className="grow" />
          <button className="ghost" aria-expanded={showSettings} onClick={() => setShowSettings(v => !v)}><span lang="ja">ふりがな</span> &amp; display</button>
        </div>
      </header>
      {showSettings && <SettingsPanel />}
      {status?.offline && <div className="wrap" style={{ paddingTop: 12 }}><div className="example-note">Can’t reach the Sakubun Desk server. Start the backend, then reload this page.</div></div>}

      <div className="wrap layout">
        <main>
          {/* Both views stay mounted so a draft, its check results and scroll position survive switching tabs. */}
          <div hidden={nav.main !== 'write'}><WriteView onLookup={lookupWord} onOpenGrammar={openGrammar} aiEnabled={aiEnabled} /></div>
          <div hidden={nav.main !== 'read'}><ReadView onLookup={lookupWord} onOpenGrammar={openGrammar} aiEnabled={aiEnabled} /></div>
        </main>
        <aside className="ref" aria-label="Reference">
          <div className="reftabs">
            {REF.map(([id, ja, en]) => (
              <button key={id} className="reftab" aria-selected={nav.ref === id} onClick={() => showRef(id)}><span className="ja" lang="ja">{ja}</span>{en}</button>
            ))}
          </div>
          <div className="backbar"><button className="link" onClick={() => showMain(nav.main)}>← Back to your text</button></div>
          <div hidden={nav.ref !== 'dict'} style={{ display: nav.ref === 'dict' ? 'contents' : undefined }}><DictionaryPane lookup={lookup} onOpenGrammar={openGrammar} /></div>
          <div hidden={nav.ref !== 'grammar'} style={{ display: nav.ref === 'grammar' ? 'contents' : undefined }}><GrammarPane openRequest={grammarOpen} /></div>
        </aside>
      </div>

      <footer className="foot"><div className="wrap">
        Dictionary data: <a href="https://www.edrdg.org/jmdict/j_jmdict.html">JMdict</a> and <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project">KANJIDIC2</a>, © Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0. Readings by Janome with the IPA dictionary. Grammar notes follow the lesson order of Genki I, Genki II and Tobira; the explanations and examples are written for this app. Checks, translations and sentence explanations are written by Claude and can be wrong.
      </div></footer>

      <nav className="bottomnav" aria-label="Sections">
        {MAIN.map(([id, ja, en]) => (
          <button key={id} aria-selected={nav.focus === 'main' && nav.main === id} onClick={() => showMain(id)}><span className="ja" lang="ja">{ja}</span><span className="lbl">{en}</span></button>
        ))}
        {REF.map(([id, ja, en]) => (
          <button key={id} aria-selected={nav.focus === 'ref' && nav.ref === id} onClick={() => showRef(id)}><span className="ja" lang="ja">{ja}</span><span className="lbl">{en}</span></button>
        ))}
      </nav>
    </SettingsProvider>
  );
}
