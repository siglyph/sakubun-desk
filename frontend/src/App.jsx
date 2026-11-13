import { useCallback, useEffect, useState } from 'react';
import { api, store } from './api.js';
import { SettingsPanel, SettingsProvider } from './settings.jsx';
import WriteView from './views/WriteView.jsx';
import ReadView from './views/ReadView.jsx';
import DictionaryPane from './views/DictionaryPane.jsx';
import GrammarPane from './views/GrammarPane.jsx';

const VIEWS = [['write', '書く', 'Write'], ['read', '読む', 'Read']];
const DRAWER_TABS = [['dict', '辞書', 'Dictionary'], ['grammar', '文法', 'Grammar'], ['display', '表示', 'Display']];

const viewFromHash = () => (window.location.hash === '#read' ? 'read' : window.location.hash === '#write' ? 'write' : null);

export default function App() {
  const [view, setView] = useState(() => viewFromHash() || store.get('main', 'write'));
  const [drawer, setDrawer] = useState(null);        // null (closed) | 'dict' | 'grammar' | 'display'
  const [drawerTab, setDrawerTab] = useState('dict'); // the last tab shown, kept so the drawer can animate shut
  const [lookup, setLookup] = useState(null);        // { word } tapped in a text
  const [grammarOpen, setGrammarOpen] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => { api.get('/api/status').then(setStatus).catch(() => setStatus({ offline: true })); }, []);
  useEffect(() => {
    const onHash = () => { const v = viewFromHash(); if (v) setView(v); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    store.set('main', view);
    window.history.replaceState(null, '', '#' + view);
  }, [view]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = e => { if (e.key === 'Escape') setDrawer(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const openDrawer = useCallback(tab => { setDrawerTab(tab); setDrawer(tab); }, []);
  const lookupWord = useCallback(word => { setLookup({ word }); openDrawer('dict'); }, [openDrawer]);
  const openGrammar = useCallback(id => { setGrammarOpen({ id }); openDrawer('grammar'); }, [openDrawer]);
  const aiEnabled = status ? !!status.ai?.enabled : true;

  return (
    <SettingsProvider>
      <div className={'shell' + (drawer ? ' with-drawer' : '')}>
        <header className="top">
          <div className="bar">
            <span className="brand" lang="ja" title="Sakubun Desk">作文</span>
            <nav className="tabs" aria-label="Workspace">
              {VIEWS.map(([id, ja, en]) => (
                <button key={id} className="tab" aria-selected={view === id} onClick={() => setView(id)}><span className="ja" lang="ja">{ja}</span>{en}</button>
              ))}
            </nav>
            <span className="grow" />
            <button className="btn" aria-expanded={!!drawer} onClick={() => (drawer ? setDrawer(null) : openDrawer(drawerTab))}><span lang="ja">辞書</span> Look up</button>
          </div>
        </header>

        <main className="page">
          {status?.offline && <p className="muted" style={{ marginBottom: 14 }}>Can’t reach the Sakubun Desk server. Start the backend, then reload this page.</p>}
          {/* Both views stay mounted so a draft and its results survive switching tabs. */}
          <div hidden={view !== 'write'}><WriteView onLookup={lookupWord} onOpenGrammar={openGrammar} aiEnabled={aiEnabled} /></div>
          <div hidden={view !== 'read'}><ReadView onLookup={lookupWord} onOpenGrammar={openGrammar} aiEnabled={aiEnabled} /></div>
        </main>
      </div>

      {drawer && <div className="scrim" onClick={() => setDrawer(null)} />}
      <aside className={'drawer' + (drawer ? ' open' : '')} aria-label="Reference" aria-hidden={!drawer}>
        <div className="drawer-head">
          {DRAWER_TABS.map(([id, ja, en]) => (
            <button key={id} className="reftab" aria-selected={drawerTab === id} onClick={() => openDrawer(id)}><span className="ja" lang="ja">{ja}</span>{en}</button>
          ))}
          <button className="drawer-close" aria-label="Close" onClick={() => setDrawer(null)}>✕</button>
        </div>
        <div className="pane" hidden={drawerTab !== 'dict'}><DictionaryPane lookup={lookup} onOpenGrammar={openGrammar} /></div>
        <div className="pane" hidden={drawerTab !== 'grammar'}><GrammarPane openRequest={grammarOpen} /></div>
        <div className="pane" hidden={drawerTab !== 'display'}><SettingsPanel /></div>
      </aside>
    </SettingsProvider>
  );
}
