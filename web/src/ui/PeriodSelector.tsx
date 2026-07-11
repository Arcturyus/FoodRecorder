import { todayStr } from '../store/store';

/**
 * Sélecteur de période réutilisable (onglets Stats et Poids).
 * Présets courts + longs (« 1 an », « Tout ») + plage personnalisée début/fin.
 */

export type PeriodPreset = 7 | 30 | 90 | 365 | 'all' | 'custom';

/** Plage de dates inclusive (YYYY-MM-DD). */
export interface DateRange {
  start: string;
  end: string;
}

export interface PeriodState {
  preset: PeriodPreset;
  /** Plage saisie manuellement (utilisée seulement quand preset === 'custom'). */
  custom: DateRange;
}

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 7, label: '7 j' },
  { value: 30, label: '30 j' },
  { value: 90, label: '90 j' },
  { value: 365, label: '1 an' },
  { value: 'all', label: 'Tout' },
  { value: 'custom', label: 'Perso.' },
];

/** Date locale N jours avant aujourd'hui. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

export function defaultPeriodState(): PeriodState {
  return { preset: 30, custom: { start: daysAgo(30), end: todayStr() } };
}

/**
 * Résout la plage effective. `earliest` = 1re date de données disponibles,
 * utilisée pour borner « Tout » (défaut : 1 an si absent).
 */
export function resolveRange(state: PeriodState, earliest?: string): DateRange {
  const end = todayStr();
  if (state.preset === 'custom') {
    const { start, end: cEnd } = state.custom;
    return { start: start <= cEnd ? start : cEnd, end: cEnd || end };
  }
  if (state.preset === 'all') return { start: earliest ?? daysAgo(365), end };
  return { start: daysAgo(state.preset - 1), end };
}

/** Énumère toutes les dates (incluses) d'une plage. Généralise `lastNDates`. */
export function datesInRange(range: DateRange): string[] {
  const out: string[] = [];
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) out.push(todayStr(new Date(d)));
  return out;
}

/** Nombre de jours couverts (pour l'affichage « Analyse sur N jours »). */
export function rangeDays(range: DateRange): number {
  const a = new Date(`${range.start}T12:00:00`).getTime();
  const b = new Date(`${range.end}T12:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (s: PeriodState) => void;
}) {
  const today = todayStr();
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {PRESETS.map((p) => (
        <button
          key={String(p.value)}
          className={value.preset === p.value ? 'chip-active' : 'ghost'}
          onClick={() => onChange({ ...value, preset: p.value })}
        >
          {p.label}
        </button>
      ))}
      {value.preset === 'custom' && (
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="date"
            value={value.custom.start}
            max={today}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, start: e.target.value } })}
          />
          <span className="small">→</span>
          <input
            type="date"
            value={value.custom.end}
            max={today}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, end: e.target.value } })}
          />
        </span>
      )}
    </div>
  );
}
