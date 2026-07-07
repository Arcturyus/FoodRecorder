import { useMemo, useState } from 'react';
import { useStore, dayTotals, todayStr } from './store/store';
import { Capture } from './ui/Capture';
import { ManualAdd } from './ui/ManualAdd';
import { EntryCard } from './ui/EntryCard';
import { Totals } from './ui/Totals';
import { CustomFoods } from './ui/CustomFoods';
import { Settings } from './ui/Settings';
import { fmt } from './ui/format';

type Tab = 'jour' | 'historique' | 'aliments' | 'reglages';

export function App() {
  const [tab, setTab] = useState<Tab>('jour');
  const entries = useStore((s) => s.entries);
  const today = todayStr();

  const todayEntries = useMemo(() => entries.filter((e) => e.date === today), [entries, today]);
  const totals = useMemo(() => dayTotals(entries, today), [entries, today]);

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
        <button className={tab === 'aliments' ? 'active' : ''} onClick={() => setTab('aliments')}>
          Mes aliments
        </button>
        <button className={tab === 'reglages' ? 'active' : ''} onClick={() => setTab('reglages')}>
          Réglages
        </button>
      </div>

      {tab === 'jour' && (
        <>
          <Capture />
          <ManualAdd />
          <Totals totals={totals} />
          {todayEntries.length === 0 ? (
            <div className="panel">
              <div className="empty">Aucune entrée aujourd'hui. Dictez ou tapez votre premier repas.</div>
            </div>
          ) : (
            todayEntries.map((e) => <EntryCard key={e.id} entry={e} />)
          )}
        </>
      )}

      {tab === 'historique' && <History />}
      {tab === 'aliments' && <CustomFoods />}
      {tab === 'reglages' && <Settings />}
    </div>
  );
}

function History() {
  const entries = useStore((s) => s.entries);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const kcal = e.items.reduce((a, it) => a + it.nutrients.kcal, 0);
      map.set(e.date, (map.get(e.date) ?? 0) + kcal);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  const avg7 = useMemo(() => {
    const last7 = byDay.slice(0, 7);
    if (last7.length === 0) return 0;
    return last7.reduce((a, [, k]) => a + k, 0) / last7.length;
  }, [byDay]);

  if (byDay.length === 0) {
    return (
      <div className="panel">
        <div className="empty">Pas encore d'historique.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Historique par jour</h2>
      <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Moyenne sur les {Math.min(7, byDay.length)} derniers jours enregistrés : <strong>{fmt(avg7)} kcal/j</strong>
      </div>
      {byDay.map(([date, kcal]) => (
        <div className="item-row" key={date}>
          <span>{new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <span />
          <span className="mono" style={{ textAlign: 'right' }}>{fmt(kcal)}</span>
          <span className="small">kcal</span>
        </div>
      ))}
    </div>
  );
}
