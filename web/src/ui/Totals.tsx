import { useMemo } from 'react';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import type { JournalItem } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import type { Target } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import { useStore, dayTotals, isDayCounted, todayStr } from '../store/store';
import type { KcalUncertainty } from '../nutrition/uncertainty';
import { UncertaintyBadge } from './UncertaintyBadge';
import { shiftDays } from './PeriodSelector';
import { sunVitDForDate } from '../sun/vitaminD';
import { fmt } from './format';

/**
 * Sous-détail d'un nutriment composite : les acides gras qui se cachent derrière
 * un même total et ne se valent pas. Chaque part a sa couleur, réutilisée à
 * l'identique dans la ligne « dont … » sous la tuile et dans les barres par
 * aliment de l'infobulle — une seule ligne de légende pour tout expliquer.
 */
interface SubPart {
  key: NutrientKey;
  /** Nom court affiché dans la légende et le texte. */
  short: string;
  /** Ce que la part vaut pour la santé, en trois mots (légende). */
  hint: string;
  color: string;
}

const OMEGA3_PARTS: SubPart[] = [
  { key: 'omega3Ala', short: 'ALA', hint: 'végétal, mal converti', color: 'var(--accent)' },
  { key: 'omega3Epa', short: 'EPA', hint: 'marin, direct', color: 'var(--accent-2)' },
  { key: 'omega3Dha', short: 'DHA', hint: 'marin, direct', color: 'var(--ia)' },
];

const AG_SATURES_PARTS: SubPart[] = [
  { key: 'agSaturesLdl', short: 'C16+C14', hint: 'à limiter (font monter le LDL)', color: 'var(--danger)' },
  { key: 'agSaturesStearique', short: 'C18 stéarique', hint: 'neutre sur le LDL', color: 'var(--accent-2)' },
];

/** Sous-détail associé à un nutriment, s'il en a un. */
const PARTS_BY_KEY: Partial<Record<NutrientKey, SubPart[]>> = {
  omega3: OMEGA3_PARTS,
  agSatures: AG_SATURES_PARTS,
};

/** Couleur du reliquat non détaillé (total − somme des parts). */
const REST_COLOR = 'var(--muted)';

interface Contribution {
  nom: string;
  amount: number;
  /** Valeur de chaque sous-part pour CET aliment (même ordre que `parts`). */
  parts: number[];
}

/**
 * Principaux aliments du jour apportant un nutriment donné, du plus au moins
 * contributeur. Les items sont regroupés par nom affiché (deux entrées du même
 * aliment se cumulent). `parts` porte, pour chaque aliment, la décomposition du
 * nutriment (ALA/EPA/DHA, C16+C14 / C18…) — vide si le nutriment n'en a pas.
 */
function topContributors(items: JournalItem[], key: NutrientKey, parts: SubPart[], limit = 6): Contribution[] {
  const byName = new Map<string, Contribution>();
  for (const it of items) {
    const v = it.nutrients[key];
    if (v <= 0) continue;
    const cur = byName.get(it.nomAffiche) ?? { nom: it.nomAffiche, amount: 0, parts: parts.map(() => 0) };
    cur.amount += v;
    // `?? 0` : un item peut venir d'un snapshot antérieur à l'ajout d'un
    // sous-nutriment — un trou doit rester un 0, jamais un NaN affiché.
    parts.forEach((p, i) => {
      cur.parts[i] += it.nutrients[p.key] ?? 0;
    });
    byName.set(it.nomAffiche, cur);
  }
  return [...byName.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/**
 * Barre de composition d'un aliment : une par sous-part, mises côte à côte.
 * Largeur totale = poids de l'aliment par rapport au plus gros contributeur
 * (on lit d'un coup qui pèse), segments = sa composition interne. Le reliquat
 * gris est la part non détaillée (chaînes courtes des laitages, C12…) : la
 * montrer évite de laisser croire que la somme fait le total.
 */
function PartsBar({ parts, values, amount, max }: { parts: SubPart[]; values: number[]; amount: number; max: number }) {
  const sum = values.reduce((a, v) => a + v, 0);
  const rest = Math.max(0, amount - sum);
  const scale = max > 0 ? amount / max : 0;
  if (amount <= 0) return null;
  return (
    <div className="bd-parts" style={{ width: `${Math.max(4, scale * 100)}%` }}>
      {parts.map((p, i) => (
        <span key={p.key} style={{ flexGrow: values[i], background: p.color }} title={`${p.short} ${fmt(values[i], 2)}`} />
      ))}
      {rest > 0.005 && <span style={{ flexGrow: rest, background: REST_COLOR, opacity: 0.45 }} title={`non détaillé ${fmt(rest, 2)}`} />}
    </div>
  );
}

/** Infobulle listant les aliments qui contribuent le plus à un nutriment. */
function Breakdown({
  items,
  nutrientKey,
  unit,
  total,
}: {
  items: JournalItem[];
  nutrientKey: NutrientKey;
  unit: string;
  total: number;
}) {
  const parts = PARTS_BY_KEY[nutrientKey] ?? [];
  const contribs = useMemo(() => topContributors(items, nutrientKey, parts), [items, nutrientKey, parts]);
  const max = contribs[0]?.amount ?? 0;
  // Une barre ne se justifie que si au moins un aliment a un détail connu.
  const showParts = parts.length > 0 && contribs.some((c) => c.parts.some((v) => v > 0));
  return (
    <div className="breakdown" role="tooltip">
      <div className="bd-title">Principaux apports</div>
      {contribs.length === 0 ? (
        <div className="bd-empty">Aucun apport aujourd'hui.</div>
      ) : (
        <>
          <ul>
            {contribs.map((c) => (
              <li key={c.nom} className={showParts ? 'has-parts' : undefined}>
                <span className="bd-nom">{c.nom}</span>
                <span className="bd-val mono">
                  {fmt(c.amount, c.amount < 10 ? 1 : 0)} {unit}
                  {total > 0 && <span className="bd-pct"> · {fmt((c.amount / total) * 100)}%</span>}
                </span>
                {showParts && (
                  <>
                    <PartsBar parts={parts} values={c.parts} amount={c.amount} max={max} />
                    <span className="bd-parts-text mono">
                      {parts.map((p, i) => `${p.short} ${fmt(c.parts[i], 2)}`).join(' · ')}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {showParts && (
            <div className="bd-legend small">
              {parts.map((p) => (
                <span key={p.key}>
                  <i style={{ background: p.color }} />
                  {p.short} <em>{p.hint}</em>
                </span>
              ))}
              <span>
                <i style={{ background: REST_COLOR, opacity: 0.45 }} />
                non détaillé
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Répartition ALA/EPA/DHA sous la tuile oméga-3 : l'ALA (végétal) est affiché
 * en valeur brute ET en équivalent pondéré (÷10, mal converti par le corps),
 * seul celui-ci comptant dans la cible/le score/les rapports. EPA et DHA
 * (marins/animaux) comptent pour leur valeur brute. Les pastilles de couleur
 * reprennent celles des barres par aliment de l'infobulle.
 */
export function Omega3Breakdown({ totals }: { totals: Nutrients }) {
  const { omega3Ala, omega3Epa, omega3Dha } = totals;
  if (omega3Ala <= 0 && omega3Epa <= 0 && omega3Dha <= 0) return null;
  return (
    <div className="sub-detail small mono">
      dont <i style={{ background: OMEGA3_PARTS[0].color }} />
      ALA {fmt(omega3Ala, 1)} g (≈ {fmt(omega3Ala / 10, 2)} g éq.) · <i style={{ background: OMEGA3_PARTS[1].color }} />
      EPA {fmt(omega3Epa, 1)} g · <i style={{ background: OMEGA3_PARTS[2].color }} />
      DHA {fmt(omega3Dha, 1)} g
    </div>
  );
}

/**
 * Répartition des AG saturés sous leur tuile — le pendant du sous-détail
 * oméga 3. Affiche la seule chose qui compte vraiment : combien viennent des
 * acides gras qui élèvent le LDL (avec LEUR plafond, pas celui du total), et
 * combien du stéarique, neutre. Le reliquat non détaillé n'est mentionné que
 * s'il est significatif, pour ne pas alourdir la tuile.
 */
export function SaturatedBreakdown({ totals, targets }: { totals: Nutrients; targets: Target[] }) {
  const { agSatures, agSaturesLdl, agSaturesStearique } = totals;
  if (agSatures <= 0) return null;
  const ldlTarget = targets.find((t) => t.key === 'agSaturesLdl');
  if (agSaturesLdl <= 0 && agSaturesStearique <= 0) {
    return <div className="sub-detail small mono">répartition non détaillée pour ces aliments</div>;
  }
  const rest = Math.max(0, agSatures - agSaturesLdl - agSaturesStearique);
  const over = ldlTarget != null && agSaturesLdl > ldlTarget.ajr;
  return (
    <div className="sub-detail small mono">
      dont <i style={{ background: AG_SATURES_PARTS[0].color }} />
      <span style={over ? { color: 'var(--danger)' } : undefined}>
        à limiter {fmt(agSaturesLdl, 1)} g{ldlTarget && ` / ${fmt(ldlTarget.ajr)}`}
      </span>{' '}
      · <i style={{ background: AG_SATURES_PARTS[1].color }} />
      stéarique {fmt(agSaturesStearique, 1)} g (neutre)
      {rest > 0.1 && ` · ${fmt(rest, 1)} g non détaillés`}
    </div>
  );
}

/**
 * Zone d'excès d'une tuile. Elle N'APPARAÎT QUE lorsque la cible est dépassée :
 * la barre principale s'arrête à la cible et devient inutile au-delà (elle est
 * pleine), alors même que c'est le moment où l'on aimerait savoir si l'on est à
 * peine au-dessus ou en zone à risque. Trente barres d'excès affichées en
 * permanence rendraient la grille illisible pour une question qui ne se pose
 * presque jamais.
 *
 * L'échelle va de la cible (`from`) jusqu'à la dose où des effets ont été
 * OBSERVÉS (`toxic`), avec un repère sur le seuil de prudence (`upper`) — les
 * deux ne se valent pas, et les confondre transformerait « au-delà, ce n'est
 * plus anodin » en « danger », ce qui est faux pour la plupart des nutriments.
 * À défaut de `toxic` connu, l'échelle s'arrête au seuil de prudence.
 */
function ExcessBar({
  value,
  from,
  upper,
  toxic,
  unit,
}: {
  value: number;
  /** Début de la zone : l'optimal (nutriment à couvrir) ou le plafond (limite). */
  from: number;
  upper?: number;
  toxic?: number;
  unit: string;
}) {
  const end = toxic ?? upper;
  if (end == null || end <= from || value <= from) return null;
  const span = end - from;
  const pct = ((value - from) / span) * 100;
  // Repère de prudence, seulement s'il tombe DANS l'échelle (donc si `toxic` existe).
  const mark = upper != null && upper > from && upper < end ? ((upper - from) / span) * 100 : null;
  const over = upper != null && value >= upper;
  return (
    <div className="excess">
      <div className={`bar excess-bar${over ? ' over' : ''}`}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
        {mark != null && (
          <i className="mark upper" style={{ left: `${mark}%` }} data-tip={`Prudence au-delà de ${fmt(upper!)} ${unit}`} />
        )}
      </div>
      <div className="small mono excess-note">
        {over
          ? `au-delà du seuil de prudence (${fmt(upper!, upper! < 10 ? 1 : 0)} ${unit})`
          : upper != null
            ? `au-dessus de la cible · prudence à ${fmt(upper, upper < 10 ? 1 : 0)} ${unit}`
            : // Pas de seuil de prudence chiffré (sodium, AG trans) : c'est la dose
              // des effets observés qui donne l'échelle, autant la nommer.
              `au-dessus de la cible · effets observés à ${fmt(toxic!, toxic! < 10 ? 1 : 0)} ${unit}`}
      </div>
    </div>
  );
}

/** Fenêtre de la moyenne « seuil de carence » : 7 jours calendaires, non pondérés. */
const LOW_THRESHOLD_WINDOW = 7;

/**
 * Moyenne PLATE (non pondérée) des `days` jours calendaires précédant `anchor` —
 * le jour affiché lui-même est exclu (encore en cours s'il s'agit d'aujourd'hui,
 * et pour rester cohérent avec la lecture d'un jour passé). Jours mutés ou non
 * remplis ignorés, jamais comptés comme des zéros. `null` si aucun jour dispo,
 * pour distinguer « pas encore assez de données » de « moyenne à 0 ».
 */
function useTrailingAverage(anchor: string, days: number): Nutrients | null {
  const entries = useStore((s) => s.entries);
  const mutedDays = useStore((s) => s.mutedDays);
  const sunExposures = useStore((s) => s.sunExposures);
  return useMemo(() => {
    const filled = new Set(entries.map((e) => e.date));
    const sum: Nutrients = { ...EMPTY_NUTRIENTS };
    const keys = Object.keys(sum) as NutrientKey[];
    let n = 0;
    for (let age = 1; age <= days; age++) {
      const date = shiftDays(anchor, age);
      if (!isDayCounted(mutedDays, filled.has(date), date)) continue;
      const t = dayTotals(entries, date);
      const sun = sunVitDForDate(sunExposures, date);
      const withSun = sun > 0 ? { ...t, vitD: t.vitD + sun } : t;
      for (const k of keys) sum[k] += withSun[k];
      n++;
    }
    if (n === 0) return null;
    const avg: Nutrients = { ...EMPTY_NUTRIENTS };
    for (const k of keys) avg[k] = sum[k] / n;
    return avg;
  }, [entries, mutedDays, sunExposures, anchor, days]);
}

/**
 * Repère « seuil de carence » sous une tuile : toujours affiché quand le guide
 * documente un seuil réel (`t.lowThreshold`, cf. `rda.ts`), pas seulement en
 * alerte — au même titre que le repère AJR sur la barre. Rouge sous le seuil,
 * discret sinon. `data-tip` porte l'effet documenté (`t.lowNote`).
 */
function LowThresholdNote({
  value,
  threshold,
  unit,
  note,
}: {
  value: number | null;
  threshold: number;
  unit: string;
  note?: string;
}) {
  if (value == null) return null;
  const below = value < threshold;
  return (
    <div
      className="small mono"
      style={{ marginTop: 4, color: below ? 'var(--danger)' : 'var(--muted)' }}
      data-tip={note}
    >
      {below && '⚠️ '}
      seuil de carence {fmt(threshold, threshold < 10 ? 1 : 0)} {unit} · moy. 7 j {fmt(value, value < 10 ? 1 : 0)} {unit}
    </div>
  );
}

/**
 * Bilan du jour : kcal + macros en tête, puis grille de tous les nutriments avec
 * une barre de progression vers la cible « optimale » et un repère sur l'AJR.
 * Chaque tuile est survolable (ou tapable) pour voir les aliments qui apportent
 * le plus de ce nutriment.
 */
export function Totals({
  totals,
  items,
  incertitude,
  date,
}: {
  totals: Nutrients;
  items: JournalItem[];
  /** Incertitude ± kcal du jour (badge « ~ » discret sur la barre de calories). */
  incertitude?: KcalUncertainty;
  /** Jour affiché (défaut : aujourd'hui) — ancre la moyenne 7 j du seuil de carence. */
  date?: string;
}) {
  const profile = useStore((s) => s.profile);
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const recentAvg = useTrailingAverage(date ?? todayStr(), LOW_THRESHOLD_WINDOW);

  const kcalT = targets.find((t) => t.key === 'kcal')!;
  const headline = targets.filter((t) =>
    ['proteines', 'glucides', 'lipides', 'fibres'].includes(t.key),
  );
  // Les sous-détails (C16+C14, stéarique) n'ont pas de tuile : ils s'affichent
  // sous celle de leur parent, sinon la grille doublerait la même information.
  const grid = targets.filter((t) => t.key !== 'kcal' && !t.parent);
  const ratios = useMemo(() => computeRatios(totals), [totals]);

  return (
    <div className="panel">
      <div className="macro-summary">
        <div className="m has-breakdown" tabIndex={0}>
          <span className="v mono">{fmt(totals.kcal)}</span>
          <span className="l">kcal · obj. {fmt(kcalT.optimal)}</span>
          <Breakdown items={items} nutrientKey="kcal" unit="kcal" total={totals.kcal} />
        </div>
        {headline.map((t) => (
          <div className="m has-breakdown" key={t.key} tabIndex={0}>
            <span className="v mono">
              {fmt(totals[t.key])}
              <span style={{ fontSize: 13 }}> {t.unit}</span>
            </span>
            <span className="l">{t.label} · obj. {fmt(t.optimal)}</span>
            <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={totals[t.key]} />
          </div>
        ))}
      </div>

      <KcalBar consumed={totals.kcal} target={kcalT.optimal} incertitude={incertitude} />

      <div className="totals-grid" style={{ marginTop: 14 }}>
        {grid.map((t) => {
          const value = totals[t.key];

          if (t.goal === 'limit') {
            // On cherche le plus bas possible : échelle 0 → plafond (ajr),
            // repère sur la cible basse idéale (optimal).
            const pct = t.ajr > 0 ? (value / t.ajr) * 100 : 0;
            const optMark = t.ajr > 0 ? Math.min(100, (t.optimal / t.ajr) * 100) : 0;
            const barClass = value > t.ajr ? 'over' : value <= t.optimal ? 'good' : '';
            return (
              <div className="stat has-breakdown" key={t.key} tabIndex={0}>
                <div className="label">{t.label}</div>
                <div className="value mono">
                  {fmt(value, value < 10 ? 1 : 0)} <small>{t.unit}</small>
                </div>
                <div className={`bar ${barClass}`}>
                  <span style={{ width: `${Math.min(100, pct)}%` }} />
                  <i className="mark opti" style={{ left: `${optMark}%` }} data-tip={`Idéal ≤ ${fmt(t.optimal)} ${t.unit}`} />
                </div>
                <div className="small mono">
                  {fmt(pct)}% du plafond · idéal ≤ {fmt(t.optimal)} / max {fmt(t.ajr)}
                </div>
                {/* Au-delà du plafond, l'échelle repart vers la dose des effets observés. */}
                <ExcessBar value={value} from={t.ajr} upper={t.upper} toxic={t.toxic} unit={t.unit} />
                {t.key === 'agSatures' && <SaturatedBreakdown totals={totals} targets={targets} />}
                <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={value} />
              </div>
            );
          }

          const distinct = t.optimal !== t.ajr;
          const pctOpt = t.optimal > 0 ? (value / t.optimal) * 100 : 0;
          // Repère AJR positionné sur l'échelle 0 → optimal.
          const ajrMark = t.optimal > 0 ? Math.min(100, (t.ajr / t.optimal) * 100) : 0;
          const barClass = value >= t.ajr ? 'good' : '';

          return (
            <div className="stat has-breakdown" key={t.key} tabIndex={0}>
              <div className="label">{t.label}</div>
              <div className="value mono">
                {fmt(value, value < 10 ? 1 : 0)} <small>{t.unit}</small>
              </div>
              <div className={`bar ${barClass}`}>
                <span style={{ width: `${Math.min(100, pctOpt)}%` }} />
                {distinct && (
                  <i className="mark ajr" style={{ left: `${ajrMark}%` }} data-tip={`AJR ${fmt(t.ajr)} ${t.unit}`} />
                )}
                {t.lowThreshold != null && t.optimal > 0 && (
                  <i
                    className="mark low"
                    style={{ left: `${Math.min(100, (t.lowThreshold / t.optimal) * 100)}%` }}
                    data-tip={`Seuil de carence documenté : ${fmt(t.lowThreshold)} ${t.unit}`}
                  />
                )}
              </div>
              <div className="small mono">
                {fmt(pctOpt)}%{' '}
                {distinct ? `· AJR ${fmt(t.ajr)} / opti ${fmt(t.optimal)}` : `· AJR ${fmt(t.ajr)}`}
              </div>
              <ExcessBar value={value} from={t.optimal} upper={t.upper} toxic={t.toxic} unit={t.unit} />
              {t.lowThreshold != null && (
                <LowThresholdNote
                  value={recentAvg ? recentAvg[t.key] : null}
                  threshold={t.lowThreshold}
                  unit={t.unit}
                  note={t.lowNote}
                />
              )}
              {t.key === 'omega3' && <Omega3Breakdown totals={totals} />}
              <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={value} />
            </div>
          );
        })}
      </div>

      <RatioRow ratios={ratios} />
    </div>
  );
}

/**
 * Barre de calories du jour : progression vers l'objectif + reste à manger
 * (ou dépassement). Répond au besoin « savoir combien il reste pour la journée ».
 */
function KcalBar({
  consumed,
  target,
  incertitude,
}: {
  consumed: number;
  target: number;
  incertitude?: KcalUncertainty;
}) {
  const pct = target > 0 ? (consumed / target) * 100 : 0;
  const remaining = target - consumed;
  const over = remaining < 0;
  return (
    <div className="kcal-bar">
      <div className="kcal-bar-head">
        <span className="small">
          <strong className="mono">{fmt(consumed)}</strong> / {fmt(target)} kcal
          {incertitude && <UncertaintyBadge kcal={consumed} unc={incertitude} />}
        </span>
        <span className={`small mono kcal-remaining${over ? ' over' : ''}`}>
          {over ? `dépassé de ${fmt(-remaining)} kcal` : `reste ${fmt(remaining)} kcal`}
        </span>
      </div>
      <div className={`bar${over ? ' over' : consumed >= target ? ' good' : ''}`} style={{ height: 10 }}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

const RATIO_STATUS_COLOR: Record<string, string> = {
  good: 'var(--accent-2)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  na: 'var(--muted)',
};

/** Cible idéale d'un rapport, formatée avec le bon symbole (≥ / ≤ / ≈). */
function ratioTargetText(def: RatioResult['def']): string {
  const val = `${fmt(def.optimal)}${def.suffix}`;
  if (def.better === 'higher') return `idéal ≥ ${val}`;
  if (def.better === 'lower') return `idéal ≤ ${val}`;
  return `idéal ≈ ${val}`;
}

const RATIO_STATUS_WORD: Record<string, string> = {
  good: 'dans la cible',
  warn: 'à surveiller',
  bad: 'hors cible',
  na: 'pas encore de donnée',
};

/** Rapports optimaux du jour (oméga-6/3, potassium/sodium, calcium/magnésium). */
function RatioRow({ ratios }: { ratios: RatioResult[] }) {
  return (
    <div className="ratio-row" style={{ marginTop: 16 }}>
      <div className="small" style={{ marginBottom: 8, opacity: 0.8 }}>
        Rapports du jour · survolez pour le détail (aussi dans l'onglet Nutriments)
      </div>
      <div className="totals-grid">
        {ratios.map((r) => {
          const color = RATIO_STATUS_COLOR[r.status];
          return (
            <div className="stat has-breakdown" key={r.def.key} tabIndex={0}>
              <div className="label">{r.def.label}</div>
              <div className="value mono" style={{ color }}>
                {r.text}
              </div>
              <div className="small mono">{ratioTargetText(r.def)}</div>
              {/* Info-bulle riche (même style que les tuiles de nutriments), remplace le title natif. */}
              <div className="breakdown" role="tooltip">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span className="bd-nom" style={{ fontWeight: 600, color: 'var(--text)' }}>{r.def.label}</span>
                  <span className="mono" style={{ color, fontWeight: 700 }}>
                    {r.text} · {RATIO_STATUS_WORD[r.status]}
                  </span>
                </div>
                <div className="small" style={{ marginBottom: 6, color: 'var(--muted)' }}>{r.def.role}</div>
                <div className="small" style={{ color: 'var(--text)' }}>{r.def.note}</div>
                <div className="small mono" style={{ marginTop: 8, color: 'var(--accent-2)' }}>{ratioTargetText(r.def)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
