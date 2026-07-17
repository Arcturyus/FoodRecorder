import { useEffect, useMemo, useState } from 'react';
import { useStore, dayTotals, todayStr } from './store/store';
import type { JournalItem } from './store/store';
import { EMPTY_NUTRIENTS } from './nutrition/types';
import { dayKcalUncertainty } from './nutrition/uncertainty';
import { sunVitDForDate } from './sun/vitaminD';
import { isSyncConfigured } from './sync/supabase';
import { runSyncTick } from './sync/poller';
import { runAutoSaveTick } from './store/autosave';

/** Intervalle entre deux vérifications de la file de synchro (30 s). */
const SYNC_INTERVAL_MS = 30_000;
import { Capture } from './ui/Capture';
import { Sun } from './ui/Sun';
import { ManualAdd } from './ui/ManualAdd';
import { FavoriteMeals } from './ui/FavoriteMeals';
import { EntryCard } from './ui/EntryCard';
import { Totals } from './ui/Totals';
import { Foods } from './ui/Foods';
import { Stats } from './ui/Stats';
import { Weight } from './ui/Weight';
import { Guide } from './ui/Guide';
import { History } from './ui/History';
import { Settings } from './ui/Settings';

type Tab = 'jour' | 'historique' | 'stats' | 'poids' | 'aliments' | 'guide' | 'reglages';

interface TabMeta {
  id: Tab;
  /** Libellé complet (barre du haut, ordinateur). */
  label: string;
  /** Libellé court (barre du bas, mobile). */
  short: string;
  icon: string;
}

/** Onglets principaux : accessibles directement dans la barre du bas (mobile). */
const PRIMARY_TABS: TabMeta[] = [
  { id: 'jour', label: "Aujourd'hui", short: 'Jour', icon: '🍽' },
  { id: 'historique', label: 'Historique', short: 'Historique', icon: '📅' },
  { id: 'stats', label: 'Stats', short: 'Stats', icon: '📊' },
  { id: 'poids', label: 'Poids', short: 'Poids', icon: '⚖️' },
];

/** Onglets secondaires : regroupés derrière « Plus » sur mobile. */
const SECONDARY_TABS: TabMeta[] = [
  { id: 'aliments', label: 'Aliments', short: 'Aliments', icon: '🥗' },
  { id: 'guide', label: 'Guide', short: 'Guide', icon: '📖' },
  { id: 'reglages', label: 'Réglages', short: 'Réglages', icon: '⚙️' },
];

const ALL_TABS: TabMeta[] = [...PRIMARY_TABS, ...SECONDARY_TABS];

export function App() {
  const [tab, setTab] = useState<Tab>('jour');
  const [showMore, setShowMore] = useState(false);
  const entries = useStore((s) => s.entries);
  const today = todayStr();

  const sunExposures = useStore((s) => s.sunExposures);

  const todayEntries = useMemo(() => entries.filter((e) => e.date === today), [entries, today]);
  // Le soleil n'est pas un aliment : son gain de vitamine D estimé s'ajoute au
  // bilan du jour via un pseudo-item (visible dans l'infobulle « Principaux apports »).
  const sunVitD = useMemo(() => sunVitDForDate(sunExposures, today), [sunExposures, today]);
  const todayItems = useMemo(() => {
    const items = todayEntries.flatMap((e) => e.items);
    if (sunVitD <= 0) return items;
    const sunItem: JournalItem = {
      id: 'sun-today',
      foodId: null,
      nomAffiche: '☀️ Soleil (exposition)',
      quantite: 1,
      unite: 'g',
      grams: 0,
      nutrients: { ...EMPTY_NUTRIENTS, vitD: sunVitD },
      estimation: true,
      douteux: false,
    };
    return [...items, sunItem];
  }, [todayEntries, sunVitD]);
  const totals = useMemo(() => {
    const t = dayTotals(entries, today);
    return sunVitD > 0 ? { ...t, vitD: t.vitD + sunVitD } : t;
  }, [entries, today, sunVitD]);
  const kcalUnc = useMemo(() => dayKcalUncertainty(todayEntries), [todayEntries]);

  useEffect(() => {
    if (!isSyncConfigured()) return;
    runSyncTick();
    const id = setInterval(runSyncTick, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Filet de sécurité : une sauvegarde JSON par jour sur le disque, à la
  // première ouverture (sous `npm run dev` uniquement — no-op ailleurs).
  useEffect(() => {
    runAutoSaveTick();
  }, []);

  return (
    <div className="app">
      <header className="app-head">
        <h1>🍽️ FoodRecorder</h1>
      </header>

      {/* Barre d'onglets du haut : ordinateur (masquée sur mobile via CSS). */}
      <nav className="tabs">
        {ALL_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'jour' && (
        <>
          <Capture />
          <FavoriteMeals />
          <ManualAdd />
          <Totals totals={totals} items={todayItems} incertitude={kcalUnc} />
          {todayEntries.length === 0 ? (
            <div className="panel">
              <div className="empty">Aucune entrée aujourd'hui. Dictez ou tapez votre premier repas.</div>
            </div>
          ) : (
            todayEntries.map((e) => <EntryCard key={e.id} entry={e} />)
          )}
          <Sun />
        </>
      )}

      {tab === 'historique' && <History />}
      {tab === 'stats' && <Stats />}
      {tab === 'poids' && <Weight />}
      {tab === 'aliments' && <Foods />}
      {tab === 'guide' && <Guide />}
      {tab === 'reglages' && <Settings />}

      {/* Feuille « Plus » (mobile) : onglets secondaires. */}
      {showMore && (
        <>
          <div className="more-backdrop" onClick={() => setShowMore(false)} />
          <div className="more-sheet" role="menu">
            {SECONDARY_TABS.map((t) => (
              <button
                key={t.id}
                className={`more-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => {
                  setTab(t.id);
                  setShowMore(false);
                }}
              >
                <span className="more-icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Barre d'onglets du bas : mobile (masquée sur ordinateur via CSS). */}
      <nav className="tabbar">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.id}
            className={`tabbar-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              setTab(t.id);
              setShowMore(false);
            }}
          >
            <span className="tabbar-icon">{t.icon}</span>
            <span className="tabbar-label">{t.short}</span>
          </button>
        ))}
        <button
          className={`tabbar-btn ${showMore || SECONDARY_TABS.some((t) => t.id === tab) ? 'active' : ''}`}
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          <span className="tabbar-icon">⋯</span>
          <span className="tabbar-label">Plus</span>
        </button>
      </nav>
    </div>
  );
}
