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

// ---------------------------------------------------------------------------
// Granularité : regrouper les dates par semaine ou par mois
// ---------------------------------------------------------------------------

/** Pas de temps des graphiques : un point par jour, par semaine ou par mois. */
export type Granularity = 'jour' | 'semaine' | 'mois';

/** Un groupe de dates (un point/une barre de graphique) après agrégation. */
export interface DateBucket {
  /** Clé triable du regroupement : la date elle-même, le lundi, ou `YYYY-MM`. */
  key: string;
  /** Libellé lisible (« lun. 13 juil. », « sem. du 13 juil. », « juillet 2026 »). */
  label: string;
  /**
   * Date représentative pour l'axe temps : la PREMIÈRE date réellement présente
   * du groupe, jamais le lundi/1er du mois théorique — sinon un point pourrait
   * tomber avant le début de la période affichée.
   */
  date: string;
  /** Dates couvertes, triées. */
  dates: string[];
}

/** Lundi de la semaine d'une date (semaines ISO : la semaine commence lundi). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayStr(d);
}

/** Clé du groupe auquel appartient une date. */
export function bucketKey(date: string, g: Granularity): string {
  if (g === 'semaine') return mondayOf(date);
  if (g === 'mois') return date.slice(0, 7);
  return date;
}

/** Libellé lisible d'une clé de groupe. */
export function bucketLabel(key: string, g: Granularity): string {
  if (g === 'mois') {
    return new Date(`${key}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }
  const d = new Date(`${key}T12:00:00`);
  if (g === 'semaine') return `sem. du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Regroupe des dates par jour / semaine / mois, dans l'ordre chronologique.
 * En granularité « jour », chaque date forme son propre groupe : les écrans
 * peuvent donc passer par les groupes en permanence, sans code de branchement.
 */
export function groupDates(dates: string[], g: Granularity): DateBucket[] {
  const map = new Map<string, string[]>();
  for (const d of [...dates].sort()) {
    const k = bucketKey(d, g);
    const arr = map.get(k);
    if (arr) arr.push(d);
    else map.set(k, [d]);
  }
  return [...map.entries()].map(([key, ds]) => ({ key, label: bucketLabel(key, g), date: ds[0], dates: ds }));
}

/** Unité d'un pas de temps, pour les libellés (« 7 j », « 7 sem. », « 7 mois »). */
export function granularityUnit(g: Granularity): string {
  return g === 'jour' ? 'j' : g === 'semaine' ? 'sem.' : 'mois';
}

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'jour', label: 'Jour' },
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
];

/** Sélecteur de pas de temps, à poser près des graphiques qu'il agrège. */
export function GranularitySelector({
  value,
  onChange,
  tip,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
  tip?: string;
}) {
  return (
    <span className="row" style={{ gap: 4, alignItems: 'center' }}>
      <span className="small" style={{ color: 'var(--muted)' }} data-tip={tip}>
        Agrégat
      </span>
      {GRANULARITIES.map((g) => (
        <button
          key={g.value}
          className={`small ${value === g.value ? 'chip-active' : 'ghost'}`}
          onClick={() => onChange(g.value)}
        >
          {g.label}
        </button>
      ))}
    </span>
  );
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
