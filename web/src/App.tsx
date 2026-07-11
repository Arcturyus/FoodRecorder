import { useMemo, useState } from 'react';
import { useStore, dayTotals, todayStr } from './store/store';
import type { JournalItem } from './store/store';
import { EMPTY_NUTRIENTS } from './nutrition/types';
import { sunVitDForDate } from './sun/vitaminD';
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

export function App() {
  const [tab, setTab] = useState<Tab>('jour');
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

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>🍽️ FoodRecorder</h1>
          <div className="sub">Journal nutritionnel vocal, 100 % sur votre appareil</div>
        </div>
      </header>

      <div className="tabs">
        <button className={tab === 'jour' ? 'active' : ''} onClick={() => setTab('jour')}>
          Aujourd'hui
        </button>
        <button className={tab === 'historique' ? 'active' : ''} onClick={() => setTab('historique')}>
          Historique
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button className={tab === 'poids' ? 'active' : ''} onClick={() => setTab('poids')}>
          Poids
        </button>
        <button className={tab === 'aliments' ? 'active' : ''} onClick={() => setTab('aliments')}>
          Aliments
        </button>
        <button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>
          Guide
        </button>
        <button className={tab === 'reglages' ? 'active' : ''} onClick={() => setTab('reglages')}>
          Réglages
        </button>
      </div>

      {tab === 'jour' && (
        <>
          <Capture />
          <FavoriteMeals />
          <ManualAdd />
          <Totals totals={totals} items={todayItems} />
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
    </div>
  );
}
