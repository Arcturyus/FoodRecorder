import { useMemo, useState } from 'react';
import { todayStr, isDayCounted } from '../store/store';
import { fmt } from './format';
import { dayLabel } from './DayPicker';

/**
 * Heatmap continue de l'historique, façon « contributions GitHub » : une case =
 * un jour, une colonne = une semaine (lundi en haut), plusieurs mois d'un coup.
 *
 * Le calendrier mensuel en dessous répond à « qu'ai-je mangé le 12 ? » ; il ne
 * peut pas répondre à « est-ce que je remplis régulièrement ? » — il faudrait
 * cliquer mois par mois pour le voir. C'est ce que cette vue montre : les
 * week-ends, les vacances, les trois semaines d'arrêt, d'un seul coup d'œil.
 *
 * La couleur code l'ÉCART À L'OBJECTIF kcal, pas la quantité : vert = dans la
 * cible, orange = en dessous, rouge = au-dessus, l'intensité montant avec
 * l'écart. Les jours non comptés (mal remplis, jeûnes) ne sont pas coloriés —
 * les peindre laisserait croire à une mesure là où il n'y en a pas.
 */

/** Fenêtres proposées. En jours : un « mois » calendaire n'a pas de longueur fixe. */
const WINDOWS = [
  { label: '3 mois', days: 91 },
  { label: '6 mois', days: 182 },
  { label: '12 mois', days: 365 },
] as const;

/** Une date ISO décalée de n jours (midi local : insensible aux changements d'heure). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** Jour de la semaine, lundi = 0 (comme le calendrier mensuel). */
function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
}

/**
 * Début de la fenêtre : `days` jours avant `end` (inclus), jamais avant le
 * premier jour enregistré. Sans ce plafond, un journal de deux mois s'afficherait
 * noyé dans dix mois de cases vides — un vide qui ressemble à un abandon alors
 * qu'il ne dit que « rien n'était encore saisi ».
 */
export function windowStart(end: string, days: number, first: string | null): string {
  const start = addDays(end, -(days - 1));
  return first && first > start ? first : start;
}

/**
 * Découpe [start, end] en colonnes de 7 jours alignées sur le lundi. Les cases
 * qui tombent hors de la fenêtre (avant `start`, après `end`) valent `null` :
 * elles occupent la place pour que chaque ligne reste un jour de semaine.
 */
export function heatmapColumns(start: string, end: string): (string | null)[][] {
  if (end < start) return [];
  const cols: (string | null)[][] = [];
  let cursor = addDays(start, -weekdayIndex(start));
  while (cursor <= end) {
    const col: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i);
      col.push(date >= start && date <= end ? date : null);
    }
    cols.push(col);
    cursor = addDays(cursor, 7);
  }
  return cols;
}

/**
 * Étiquettes de mois au-dessus des colonnes : une colonne appartient au mois de
 * son premier jour affiché, et les colonnes consécutives d'un même mois sont
 * regroupées en une seule étiquette (`span` = nombre de colonnes couvertes).
 */
export function monthSpans(cols: (string | null)[][]): { key: string; label: string; span: number }[] {
  const out: { key: string; label: string; span: number }[] = [];
  for (const col of cols) {
    const first = col.find((d): d is string => d !== null);
    if (!first) continue;
    const key = first.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.key === key) last.span++;
    else out.push({ key, label: monthLabel(key), span: 1 });
  }
  return out;
}

/** « août », et « janv. 26 » en janvier — repère d'année sans répéter 2026 douze fois. */
function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00`);
  const m = d.toLocaleDateString('fr-FR', { month: 'short' });
  return d.getMonth() === 0 ? `${m} ${String(d.getFullYear()).slice(2)}` : m;
}

/**
 * Écart à l'objectif traduit en couleur (le sens) et en intensité (l'ampleur).
 * Les seuils `under`/`ok`/`over` sont ceux du calendrier mensuel — même
 * vocabulaire, sinon un même jour serait orange en haut et vert en bas. Dans la
 * cible, l'intensité est maximale : c'est le résultat visé, il doit ressortir,
 * et l'écart y est petit par construction (rien à graduer).
 */
export function heatLevel(ratio: number): { level: 'under' | 'ok' | 'over'; step: 1 | 2 | 3 } {
  if (ratio < 0.7) return { level: 'under', step: ratio < 0.35 ? 3 : ratio < 0.55 ? 2 : 1 };
  if (ratio > 1.1) return { level: 'over', step: ratio > 1.6 ? 3 : ratio > 1.3 ? 2 : 1 };
  return { level: 'ok', step: 3 };
}

/**
 * Séries de jours comptés consécutifs. `courante` se lit à partir de la fin : si
 * le dernier jour (aujourd'hui) n'est pas encore rempli on repart de la veille,
 * sinon la série retomberait à zéro tous les matins.
 */
export function streaks(counted: boolean[]): { courante: number; meilleure: number } {
  let meilleure = 0;
  let run = 0;
  for (const c of counted) {
    run = c ? run + 1 : 0;
    if (run > meilleure) meilleure = run;
  }
  let i = counted.length - 1;
  if (i >= 0 && !counted[i]) i--; // journée en cours pas encore remplie
  let courante = 0;
  for (; i >= 0 && counted[i]; i--) courante++;
  return { courante, meilleure };
}

export function HistoryHeatmap({
  kcalByDate,
  mutedDays,
  kcalTarget,
  today,
  foundDates,
  selected,
  onPickDate,
}: {
  /** kcal totales par jour, sur tout l'historique. */
  kcalByDate: Map<string, number>;
  mutedDays: Record<string, boolean>;
  kcalTarget: number;
  today: string;
  /** Jours retenus par la recherche d'aliment (cerclés, comme dans le calendrier). */
  foundDates: Set<string>;
  /** Jour actuellement ouvert dans l'éditeur. */
  selected: string | null;
  onPickDate: (date: string) => void;
}) {
  const [windowDays, setWindowDays] = useState<number>(365);
  /**
   * Jour survolé, lu dans une ligne unique sous la grille. Pas d'info-bulle par
   * case : à 12 px elles se chevaucheraient, et le défilement horizontal de la
   * grille les rognerait.
   */
  const [hover, setHover] = useState<string | null>(null);

  /** Premier jour connu du journal (bornes de la fenêtre). */
  const first = useMemo(() => {
    let min: string | null = null;
    for (const d of kcalByDate.keys()) if (min === null || d < min) min = d;
    for (const d of Object.keys(mutedDays)) if (min === null || d < min) min = d;
    return min;
  }, [kcalByDate, mutedDays]);

  const start = windowStart(today, windowDays, first);
  const cols = useMemo(() => heatmapColumns(start, today), [start, today]);
  const months = useMemo(() => monthSpans(cols), [cols]);

  /** Jours de la fenêtre, dans l'ordre : sert au décompte et aux séries. */
  const windowDates = useMemo(() => cols.flat().filter((d): d is string => d !== null), [cols]);
  const countedFlags = windowDates.map((d) => isDayCounted(mutedDays, kcalByDate.has(d), d));
  const { courante, meilleure } = streaks(countedFlags);
  const remplis = windowDates.filter((d) => kcalByDate.has(d)).length;

  const hoveredKcal = hover != null ? kcalByDate.get(hover) : undefined;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Régularité</h2>
        <div className="row" style={{ gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              className={`small ${windowDays === w.days ? 'chip-active' : 'ghost'}`}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="heat"
        onMouseOver={(e) => {
          const d = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
          if (d) setHover(d);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="heat-inner">
          <div />
          <div className="heat-months">
            {months.map((m) => (
              <span key={m.key} style={{ gridColumn: `span ${m.span}` }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-wd" aria-hidden="true">
            <span>L</span>
            <span />
            <span>M</span>
            <span />
            <span>V</span>
            <span />
            <span>D</span>
          </div>
          <div className="heat-grid">
            {cols.map((col, ci) =>
              col.map((date, di) =>
                date === null ? (
                  <i key={`p${ci}-${di}`} className="heat-pad" />
                ) : (
                  <HeatCell
                    key={date}
                    date={date}
                    kcal={kcalByDate.get(date)}
                    target={kcalTarget}
                    counted={isDayCounted(mutedDays, kcalByDate.has(date), date)}
                    found={foundDates.has(date)}
                    selected={date === selected}
                    isToday={date === today}
                    onPick={onPickDate}
                  />
                ),
              ),
            )}
          </div>
        </div>
      </div>

      <div className="heat-readout small">
        {hover ? (
          <>
            <strong style={{ color: 'var(--text)' }}>{capitalize(dayLabel(hover))}</strong>
            {' — '}
            {hoveredKcal != null
              ? `${fmt(hoveredKcal)} kcal (${ecartLabel(hoveredKcal, kcalTarget)})${
                  isDayCounted(mutedDays, true, hover) ? '' : ' · non compté (mal rempli)'
                }`
              : isDayCounted(mutedDays, false, hover)
                ? 'jeûne, compté comme 0'
                : 'rien d’enregistré'}
          </>
        ) : (
          <>
            {remplis} jour(s) remplis sur {windowDates.length} · série en cours {courante} jour(s) · meilleure série{' '}
            {meilleure} jour(s). Survolez une case pour la lire, cliquez pour ouvrir la journée.
          </>
        )}
      </div>

      <div className="row small" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="heat-scale">
          en dessous
          <i className="heat-key under s3" />
          <i className="heat-key under s2" />
          <i className="heat-key under s1" />
          <i className="heat-key ok s3" />
          <i className="heat-key over s1" />
          <i className="heat-key over s2" />
          <i className="heat-key over s3" />
          au-dessus
        </span>
        <span>
          <i className="heat-key ok s3" /> dans la cible ({fmt(kcalTarget)} kcal)
        </span>
        <span>
          <i className="heat-key empty" /> rien d'enregistré
        </span>
        <span>
          <i className="heat-key fasting" /> jeûne
        </span>
        <span>
          <i className="heat-key muted" /> non compté
        </span>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        La couleur ne dit pas « bien » ou « mal » : elle situe la journée par rapport à l'objectif, à partir de ce qui a
        été saisi. Une journée à moitié remplie paraît donc « en dessous » — c'est à ça que sert 🔇 dans le calendrier
        ci-dessous.
      </div>
    </div>
  );
}

/**
 * Majuscule initiale seulement. `text-transform: capitalize` (utilisé pour les
 * TITRES de jour ailleurs dans l'app) donnerait ici « Vendredi 3 Avril » : la
 * ligne de lecture est une phrase, pas un titre.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « +6 % », « −18 % » par rapport à l'objectif — l'unité que la couleur code. */
function ecartLabel(kcal: number, target: number): string {
  if (target <= 0) return 'objectif inconnu';
  const pct = Math.round((kcal / target - 1) * 100);
  if (pct === 0) return 'pile sur l’objectif';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} % vs objectif`;
}

/**
 * Une case-jour. Seuls les jours porteurs d'information (repas saisis, jeûne
 * déclaré) sont des boutons : le vide se remplit dans le calendrier en dessous,
 * et trois cents boutons inertes de plus rendraient le parcours au clavier
 * inutilisable.
 */
function HeatCell({
  date,
  kcal,
  target,
  counted,
  found,
  selected,
  isToday,
  onPick,
}: {
  date: string;
  kcal: number | undefined;
  target: number;
  counted: boolean;
  found: boolean;
  selected: boolean;
  isToday: boolean;
  onPick: (date: string) => void;
}) {
  const filled = kcal != null;
  const fasting = !filled && counted;
  const heat = filled && target > 0 ? heatLevel(kcal / target) : null;
  const cls = [
    'heat-cell',
    filled && counted && heat ? `${heat.level} s${heat.step}` : filled ? 'muted' : fasting ? 'fasting' : 'empty',
    found ? 'found' : '',
    selected ? 'selected' : '',
    isToday ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!filled && !fasting) return <i className={cls} data-date={date} aria-hidden="true" />;

  const label = `${dayLabel(date)} : ${
    filled ? `${fmt(kcal)} kcal${counted ? '' : ', non compté'}` : 'jeûne'
  }`;
  return <button type="button" className={cls} data-date={date} aria-label={label} onClick={() => onPick(date)} />;
}
