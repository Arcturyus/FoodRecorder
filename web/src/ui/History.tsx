import { useMemo, useState } from 'react';
import { useStore, todayStr } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import { EntryCard } from './EntryCard';
import { ManualAdd } from './ManualAdd';
import { Sun } from './Sun';
import { fmt } from './format';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Date locale N jours avant aujourd'hui. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

function dayLabel(date: string, short = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    'fr-FR',
    short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' },
  );
}

/**
 * Onglet Historique : calendrier mensuel navigable. Chaque jour rempli montre ses
 * calories et un repère de couverture vs objectif. Clic sur un jour (rempli ou vide)
 * = éditer ce jour (corriger, ajouter un oubli, saisir un jour passé). Les analyses
 * poussées (tendances, moyennes) sont dans l'onglet Stats.
 */
export function History() {
  const entries = useStore((s) => s.entries);
  const profile = useStore((s) => s.profile);
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const kcalTarget = targets.find((t) => t.key === 'kcal')?.optimal ?? 2000;

  const today = todayStr();
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [editDate, setEditDate] = useState<string | null>(null);

  /** Totaux kcal par jour (tout l'historique). */
  const kcalByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const kcal = e.items.reduce((a, it) => a + it.nutrients.kcal, 0);
      map.set(e.date, (map.get(e.date) ?? 0) + kcal);
    }
    return map;
  }, [entries]);

  const recordedCount = kcalByDate.size;

  /** Cases du mois affiché (vides en tête pour aligner sur le bon jour de semaine). */
  const cells = useMemo(() => {
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    const leading = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7; // lundi = 0
    const out: (string | null)[] = Array(leading).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(todayStr(new Date(ym.y, ym.m, d)));
    return out;
  }, [ym]);

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const isCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">
            ‹
          </button>
          <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{monthLabel}</h2>
          <button className="ghost" onClick={() => shift(1)} disabled={isCurrentMonth} aria-label="Mois suivant">
            ›
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {recordedCount} jour(s) enregistré(s) au total. Cliquez un jour pour le consulter ou le modifier (ajouter un
          oubli, corriger…). Les tendances et moyennes sont dans « Stats ».
        </div>

        <div className="cal-grid cal-head">
          {WEEKDAYS.map((w, i) => (
            <div className="cal-weekday" key={i}>
              {w}
            </div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((date, i) =>
            date === null ? (
              <div key={`e${i}`} className="cal-cell empty" />
            ) : (
              <CalCell
                key={date}
                date={date}
                kcal={kcalByDate.get(date)}
                target={kcalTarget}
                isToday={date === today}
                isFuture={date > today}
                selected={date === editDate}
                onClick={() => setEditDate(date)}
              />
            ),
          )}
        </div>
        <div className="row small" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <span>
            <i className="cal-legend under" /> sous l'objectif
          </span>
          <span>
            <i className="cal-legend ok" /> proche de l'objectif
          </span>
          <span>
            <i className="cal-legend over" /> au-dessus
          </span>
        </div>
      </div>

      {editDate && <DayEditor date={editDate} onChangeDate={setEditDate} onClose={() => setEditDate(null)} />}
    </>
  );
}

/** Une case-jour du calendrier. */
function CalCell({
  date,
  kcal,
  target,
  isToday,
  isFuture,
  selected,
  onClick,
}: {
  date: string;
  kcal: number | undefined;
  target: number;
  isToday: boolean;
  isFuture: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const day = Number(date.slice(8, 10));
  const ratio = kcal != null && target > 0 ? kcal / target : 0;
  const level = kcal == null ? '' : ratio < 0.7 ? 'under' : ratio <= 1.1 ? 'ok' : 'over';

  return (
    <button
      className={`cal-cell${isToday ? ' today' : ''}${selected ? ' selected' : ''}${isFuture ? ' future' : ''}${
        kcal != null ? ' filled' : ''
      }`}
      onClick={onClick}
      disabled={isFuture}
    >
      <span className="cal-day">{day}</span>
      {kcal != null && (
        <>
          <span className="cal-kcal">{fmt(kcal)}</span>
          <span className={`cal-bar ${level}`}>
            <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Édition d'un jour
// ---------------------------------------------------------------------------

function DayEditor({
  date,
  onChangeDate,
  onClose,
}: {
  date: string;
  onChangeDate: (d: string) => void;
  onClose: () => void;
}) {
  const entries = useStore((s) => s.entries);
  const duplicateDay = useStore((s) => s.duplicateDay);
  const [flash, setFlash] = useState('');
  const today = todayStr();
  const dayEntries = entries.filter((e) => e.date === date).sort((a, b) => b.createdAt - a.createdAt);
  const kcal = dayEntries.reduce((a, e) => a + e.items.reduce((b, it) => b + it.nutrients.kcal, 0), 0);

  return (
    <div className="panel" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{dayLabel(date)}</h2>
        <button className="ghost small" onClick={onClose}>
          Fermer
        </button>
      </div>

      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <label className="field">
          Jour
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && onChangeDate(e.target.value)} />
        </label>
        <button className="ghost small" onClick={() => onChangeDate(daysAgo(1))}>
          Hier
        </button>
        <button className="ghost small" onClick={() => onChangeDate(daysAgo(2))}>
          Avant-hier
        </button>
        {date !== today && dayEntries.length > 0 && (
          <button
            className="ghost small"
            title="Recopie toutes les entrées de ce jour sur aujourd'hui (journées qui se ressemblent)"
            onClick={() => {
              duplicateDay(date);
              setFlash(`Journée du ${dayLabel(date, true)} dupliquée sur aujourd'hui (${dayEntries.length} repas).`);
            }}
          >
            ⧉ Dupliquer ce jour → aujourd'hui
          </button>
        )}
        <span className="small mono" style={{ marginLeft: 'auto' }}>
          {fmt(kcal)} kcal ce jour
        </span>
      </div>
      <div className="hint">
        « Modifier » sur une entrée : corriger aliments/quantités, ou changer sa date si elle a été saisie le mauvais
        jour. « ⧉ Auj. » sur une entrée recopie ce repas sur aujourd'hui. L'ajout ci-dessous enregistre directement
        sur ce jour.
      </div>
      {flash && <div className="status">{flash}</div>}

      {dayEntries.length === 0 ? (
        <div className="empty">Aucune entrée ce jour — ajoutez ce que vous avez mangé ci-dessous.</div>
      ) : (
        dayEntries.map((e) => <EntryCard key={e.id} entry={e} />)
      )}

      <ManualAdd date={date} title={`Ajouter un aliment au ${dayLabel(date, true)}`} />
      <Sun date={date} />
    </div>
  );
}
