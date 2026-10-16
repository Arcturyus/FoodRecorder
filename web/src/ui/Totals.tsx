import { useMemo } from 'react';
import type { NutrientKey, Nutrients, NullableNutrientKey } from '../nutrition/types';
import { EMPTY_NUTRIENTS, isNullableNutrientKey } from '../nutrition/types';
import type { DayCost } from '../nutrition/price';
import { PRICE_NOTE } from '../nutrition/price';
import type { JournalItem } from '../store/store';
import { useTargets } from './useTargets';
import { useCalorieGoals } from './useCalorieGoals';
import { calorieGoalLabel } from '../nutrition/calorieGoals';
import type { Target } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import { useStore, dayTotals, isDayCounted, todayStr } from '../store/store';
import type { KcalUncertainty } from '../nutrition/uncertainty';
import { UncertaintyBadge } from './UncertaintyBadge';
import { shiftDays } from './PeriodSelector';
import { sunVitDForDate } from '../sun/vitaminD';
import { fmt } from './format';
import { UI_STORE, useUiPref } from './uiPrefs';

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
  /** Fraction of the raw value that contributes to the parent total. */
  factor?: number;
}

const OMEGA3_PARTS: SubPart[] = [
  { key: 'omega3Ala', short: 'ALA', hint: 'valeur brute affichée · compte ÷ 10', color: 'var(--accent)', factor: 0.1 },
  { key: 'omega3Epa', short: 'EPA', hint: 'marin, direct', color: 'var(--accent-2)' },
  { key: 'omega3Dha', short: 'DHA', hint: 'marin, direct', color: 'var(--ia)' },
];

const VITAMIN_A_PARTS: SubPart[] = [
  { key: 'vitARetinol', short: 'Rétinol', hint: 'préformé, limite supérieure', color: 'var(--danger)' },
  { key: 'vitABetaCarotene', short: 'β-carotène', hint: 'valeur brute affichée · compte ÷ 12 en ER', color: 'var(--accent-2)', factor: 1 / 12 },
];

const AG_SATURES_PARTS: SubPart[] = [
  { key: 'agSaturesLdl', short: 'C16+C14', hint: 'à limiter (font monter le LDL)', color: 'var(--danger)' },
  { key: 'agSaturesStearique', short: 'C18 stéarique', hint: 'neutre sur le LDL', color: 'var(--accent-2)' },
];

/** Sous-détail associé à un nutriment, s'il en a un. */
const PARTS_BY_KEY: Partial<Record<NutrientKey, SubPart[]>> = {
  omega3: OMEGA3_PARTS,
  vitA: VITAMIN_A_PARTS,
  agSatures: AG_SATURES_PARTS,
};

/** Couleur du reliquat non détaillé (total − somme des parts). */
const REST_COLOR = 'var(--muted)';

interface Contribution {
  nom: string;
  amount: number;
  /** Valeur de chaque sous-part pour CET aliment (même ordre que `parts`). */
  parts: number[];
  /** Copper values missing from one or more entries grouped under this name. */
  unknownCount: number;
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
    if (v == null && key !== 'cuivre') continue;
    if (v != null && v <= 0) continue;
    const cur = byName.get(it.nomAffiche) ?? { nom: it.nomAffiche, amount: 0, parts: parts.map(() => 0), unknownCount: 0 };
    cur.amount += v ?? 0;
    if (v == null) cur.unknownCount++;
    // `?? 0` : un item peut venir d'un snapshot antérieur à l'ajout d'un
    // sous-nutriment — un trou doit rester un 0, jamais un NaN affiché.
    parts.forEach((p, i) => {
      cur.parts[i] += it.nutrients[p.key] ?? 0;
    });
    byName.set(it.nomAffiche, cur);
  }
  const ranked = [...byName.values()].sort((a, b) => b.amount - a.amount);
  const leading = ranked.filter((item) => item.amount > 0).slice(0, limit);
  // Une donnée inconnue de cuivre reste visible, même si six aliments connus
  // apportent déjà une valeur positive.
  const missing = ranked.filter((item) => item.unknownCount > 0 && !leading.includes(item));
  return [...leading, ...missing];
}

/**
 * Barre de composition d'un aliment : une par sous-part, mises côte à côte.
 * Largeur totale = poids de l'aliment par rapport au plus gros contributeur
 * (on lit d'un coup qui pèse), segments = sa composition interne. Le reliquat
 * gris est la part non détaillée (chaînes courtes des laitages, C12…) : la
 * montrer évite de laisser croire que la somme fait le total.
 */
function PartsBar({ parts, values, amount, max, unit }: { parts: SubPart[]; values: number[]; amount: number; max: number; unit: string }) {
  const hasScaledParts = parts.some((part) => part.factor != null && part.factor !== 1);
  const hasRawDetail = values.some((value) => value > 0);
  const weighted = values.map((value, index) => value * (parts[index].factor ?? 1));
  // Les barres ALA / bêta-carotène comparent les quantités réellement présentes
  // dans chaque aliment. Le total et le classement, eux, restent en équivalents.
  // Pour les nutriments sans facteur, le reliquat non détaillé reste comparable
  // au total et apparaît en gris comme avant.
  const shownValues = hasScaledParts && hasRawDetail ? values : weighted;
  const shownAmount = hasScaledParts && hasRawDetail ? values.reduce((sum, value) => sum + value, 0) : amount;
  const shownSum = shownValues.reduce((sum, value) => sum + value, 0);
  const rest = hasScaledParts && hasRawDetail ? 0 : Math.max(0, amount - shownSum);
  const scale = max > 0 ? shownAmount / max : 0;
  if (shownAmount <= 0) return null;
  return (
    <div className="bd-parts" style={{ width: `${Math.max(4, scale * 100)}%` }}>
      {parts.map((p, i) => (
        <span
          key={p.key}
          style={{ flexGrow: shownValues[i], background: p.color }}
          title={`${p.short} ${fmt(values[i], 2)} ${unit}${p.factor && p.factor !== 1 ? ` · contribution ${fmt(weighted[i], 2)} ${unit}` : ''}`}
        />
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
  vitAReference,
}: {
  items: JournalItem[];
  nutrientKey: NutrientKey;
  unit: string;
  total: number;
  vitAReference?: { ajr: number; lowThreshold?: number };
}) {
  const parts = PARTS_BY_KEY[nutrientKey] ?? [];
  const contribs = useMemo(() => topContributors(items, nutrientKey, parts), [items, nutrientKey, parts]);
  const hasScaledParts = parts.some((part) => part.factor != null && part.factor !== 1);
  const barAmount = (contribution: Contribution) => hasScaledParts && contribution.parts.some((value) => value > 0)
    ? contribution.parts.reduce((sum, value) => sum + value, 0)
    : contribution.amount;
  const max = Math.max(0, ...contribs.map(barAmount));
  const showParts = parts.length > 0;
  const copperUnknownCount = nutrientKey === 'cuivre' ? items.filter((item) => item.nutrients.cuivre == null).length : 0;
  return (
    <div className="breakdown" role="tooltip">
      {nutrientKey === 'vitA' && <VitaminABreakdown items={items} total={total} reference={vitAReference} />}
      {copperUnknownCount > 0 && (
        <div className="small" style={{ marginBottom: 8, color: 'var(--warn)' }}>
          Donnée de cuivre inconnue pour {copperUnknownCount} aliment(s) ; elles sont comptées à 0 dans ce graphique. Le total connu peut être inférieur au total réel.
        </div>
      )}
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
                  {c.unknownCount > 0 && <span className="bd-pct"> · {c.amount > 0 ? 'partiel, une valeur inconnue' : 'inconnu compté 0'}</span>}
                </span>
                {showParts && (
                  <>
                    <PartsBar parts={parts} values={c.parts} amount={barAmount(c)} max={max} unit={unit} />
                    <span className="bd-parts-text mono">
                      {c.parts.some((value) => value > 0)
                        ? parts.map((p, i) => `${p.short} ${fmt(c.parts[i], 2)}${p.factor && p.factor !== 1 ? ` (≈ ${fmt(c.parts[i] * p.factor, 2)} ${unit} dans le total)` : ''}`).join(' · ')
                        : `non détaillé ${fmt(c.amount, 2)} ${unit}`}
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

/** Détail visible au survol : le total reste en équivalents rétinol. */
export function VitaminABreakdown({ items, totals, total, reference }: {
  items?: JournalItem[];
  totals?: Nutrients;
  total?: number;
  reference?: { ajr: number; lowThreshold?: number };
}) {
  const retinol = items
    ? items.reduce((sum, item) => sum + (item.nutrients.vitARetinol ?? 0), 0)
    : totals?.vitARetinol ?? 0;
  const retinolUnknown = items?.filter((item) => item.nutrients.vitARetinol == null).length ?? 0;
  const beta = items
    ? items.reduce((sum, item) => sum + (item.nutrients.vitABetaCarotene ?? 0), 0)
    : totals?.vitABetaCarotene ?? 0;
  const betaUnknown = items?.filter((item) => item.nutrients.vitABetaCarotene == null).length ?? 0;
  const retinolText = items
    ? `${fmt(retinol, 1)} µg connus${retinolUnknown > 0 ? ` · ${retinolUnknown} aliment(s) sans détail` : ''}`
    : totals?.vitARetinol == null ? 'donnée inconnue' : `${fmt(retinol, 1)} µg`;
  const betaText = items
    ? `${fmt(beta, 1)} µg connus${betaUnknown > 0 ? ` · ${betaUnknown} aliment(s) sans détail` : ''}`
    : totals?.vitABetaCarotene == null ? 'donnée inconnue' : `${fmt(beta, 1)} µg`;
  const betaERText = items
    ? `${fmt(beta / 12, 1)} µg ER connus${betaUnknown > 0 ? ` · ${betaUnknown} aliment(s) sans détail` : ''}`
    : totals?.vitABetaCarotene == null ? 'équivalent inconnu' : `${fmt(beta / 12, 1)} µg ER`;
  const totalER = total ?? totals?.vitA ?? 0;
  return (
    <div className="small" style={{ marginBottom: 8 }}>
      <div className="bd-title">Vitamine A · composition</div>
      <div>
        <i aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, marginRight: 4, verticalAlign: 'middle', background: VITAMIN_A_PARTS[0].color }} />
        Rétinol préformé : <span className="mono">{retinolText}</span>
      </div>
      <div>
        <i aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, marginRight: 4, verticalAlign: 'middle', background: VITAMIN_A_PARTS[1].color }} />
        Bêta-carotène : <span className="mono">{betaText}</span> <span style={{ opacity: 0.8}}>(soit {betaERText})</span>
      </div>
      <div>Total suivi : <span className="mono">{fmt(totalER, 1)} µg ER</span>.</div>
      <div style={{ marginTop: 3, opacity: 0.8 }}>
        L’AJR du profil est {reference ? `${fmt(reference.ajr)} µg ER/j` : '750 µg ER/j (homme) ou 650 (femme)'} ; le repère bas est {reference?.lowThreshold != null ? `${fmt(reference.lowThreshold)} µg ER/j` : '300 µg ER/j (homme) ou 270 (femme)'}, un besoin moyen OMS pour prévenir la xérophtalmie, pas un diagnostic individuel.
      </div>
      <div style={{ marginTop: 3, opacity: 0.8 }}>La limite supérieure EFSA de 3 000 µg/j s’applique au rétinol préformé seul ; aucune limite supérieure n’est établie pour le bêta-carotène alimentaire.</div>
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
    const knownDays: Record<NullableNutrientKey, number> = { cuivre: 0, vitARetinol: 0, vitABetaCarotene: 0 };
    let n = 0;
    for (let age = 1; age <= days; age++) {
      const date = shiftDays(anchor, age);
      if (!isDayCounted(mutedDays, filled.has(date), date)) continue;
      const t = dayTotals(entries, date);
      const sun = sunVitDForDate(sunExposures, date);
      const withSun = sun > 0 ? { ...t, vitD: t.vitD + sun } : t;
      for (const k of keys) {
        if (isNullableNutrientKey(k)) {
          if (withSun[k] != null) {
            sum[k] = (sum[k] ?? 0) + withSun[k]!;
            knownDays[k]++;
          }
        } else sum[k] += withSun[k] ?? 0;
      }
      n++;
    }
    if (n === 0) return null;
    const avg: Nutrients = { ...EMPTY_NUTRIENTS };
    for (const k of keys) {
      if (isNullableNutrientKey(k)) avg[k] = knownDays[k] > 0 ? sum[k]! / knownDays[k] : null;
      else avg[k] = sum[k] / n;
    }
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
  label,
  note,
}: {
  value: number | null;
  threshold: number;
  unit: string;
  label?: string;
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
      {label ?? 'seuil de carence'} {fmt(threshold, threshold < 10 ? 1 : 0)} {unit} · moy. 7 j {fmt(value, value < 10 ? 1 : 0)} {unit}
    </div>
  );
}

/** Ordre d'affichage de la grille de nutriments. */
type GridSort = 'famille' | 'urgence';

/**
 * Rang d'urgence d'un nutriment : plus le score est bas, plus il demande une
 * action aujourd'hui. Trois zones se suivent, dans cet ordre :
 *
 *  1. les limites DÉPASSÉES (score négatif, le plus dépassé en tête) — c'est la
 *     seule situation où l'on a déjà fait quelque chose de contraire à la cible ;
 *  2. les nutriments à couvrir, par part de la cible atteinte (0 % d'abord) ;
 *  3. les limites respectées (≥ 2) — rien à faire, elles ferment la grille.
 *
 * Un nutriment sans cible chiffrée ne peut pas être classé : il vaut 1, soit la
 * position d'un nutriment tout juste à sa cible, plutôt qu'une fausse urgence.
 */
export function urgencyScore(t: Target, value: number | null): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  if (t.goal === 'limit') {
    const ratio = t.ajr > 0 ? value / t.ajr : 0;
    return ratio > 1 ? -ratio : 2 + (1 - ratio);
  }
  return t.optimal > 0 ? value / t.optimal : 1;
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
  cost,
  date,
}: {
  totals: Nutrients;
  items: JournalItem[];
  /** Incertitude ± kcal du jour (badge « ~ » discret sur la barre de calories). */
  incertitude?: KcalUncertainty;
  cost: DayCost;
  /** Jour affiché (défaut : aujourd'hui) — ancre la moyenne 7 j du seuil de carence. */
  date?: string;
}) {
  const targets = useTargets(date);
  const recentAvg = useTrailingAverage(date ?? todayStr(), LOW_THRESHOLD_WINDOW);
  const copperCoverage = useMemo(() => ({
    knownTotal: items.reduce((sum, item) => sum + (item.nutrients.cuivre ?? 0), 0),
    unknownCount: items.filter((item) => item.nutrients.cuivre == null).length,
  }), [items]);
  const displayValue = (key: NutrientKey) => {
    const value = totals[key];
    return key === 'cuivre' && value == null ? copperCoverage.knownTotal : value;
  };

  const kcalT = targets.find((t) => t.key === 'kcal')!;
  const goalForDate = useCalorieGoals(kcalT.optimal);
  const dayGoal = date ? goalForDate(date) : null;
  const headline = targets.filter((t) =>
    ['proteines', 'glucides', 'lipides', 'fibres'].includes(t.key),
  );
  // Les sous-détails (C16+C14, stéarique) n'ont pas de tuile : ils s'affichent
  // sous celle de leur parent, sinon la grille doublerait la même information.
  const gridAll = targets.filter((t) => t.key !== 'kcal' && !t.parent);
  const ratios = useMemo(() => computeRatios(totals), [totals]);

  /**
   * Le mur de nutriments est REPLIÉ par défaut : c'est la première chose que
   * voit quelqu'un qui ouvre l'app le matin, et à ce moment-là ce sont 38 cartes
   * à `0 g · 0 %` sur 1 908 px de haut au téléphone. Ce qui se lit d'un coup
   * d'œil — calories et macros — reste au-dessus ; le détail se demande.
   */
  const [open, setOpen] = useUiPref(UI_STORE, 'day-nutrients-open', false);
  const [sort, setSort] = useUiPref<GridSort>(UI_STORE, 'day-nutrients-sort', 'famille');

  // Tri « par urgence » : on ne réordonne QUE l'affichage, jamais les cibles.
  // L'ordre par famille reste celui de `rda.ts` (vitamines ensemble, minéraux
  // ensemble), qui est le bon quand on cherche un nutriment précis.
  const grid =
    sort === 'famille'
      ? gridAll
      : [...gridAll].sort((a, b) => urgencyScore(a, displayValue(a.key)) - urgencyScore(b, displayValue(b.key)));

  return (
    <div className="panel">
      <div className="macro-summary">
        <div className="m has-breakdown" tabIndex={0}>
          <span className="v mono">{fmt(totals.kcal)}</span>
          <span className="l">kcal · obj. {fmt(kcalT.optimal)}</span>
          <Breakdown items={items} nutrientKey="kcal" unit="kcal" total={totals.kcal} />
        </div>
        {headline.map((t) => {
          const value = totals[t.key] ?? 0;
          return (
            <div className="m has-breakdown" key={t.key} tabIndex={0}>
              <span className="v mono">
                {fmt(value)}
                <span style={{ fontSize: 13 }}> {t.unit}</span>
              </span>
              <span className="l">{t.label} · obj. {fmt(t.optimal)}</span>
              <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={value} />
            </div>
          );
        })}
        <div className="m has-breakdown" tabIndex={0}>
          <span className="v mono">{cost.pricedItems > 0 || cost.complete ? fmt(cost.knownEur, 2) : '—'}<span style={{ fontSize: 13 }}> €</span></span>
          <span className="l">Prix estimé{cost.complete ? '' : ` · partiel (${cost.missingNames.length} sans prix)`}</span>
          <div className="breakdown" role="tooltip">
            <div className="bd-title">Coût estimé · {PRICE_NOTE}</div>
            <div className="small">Prix actuel des fiches, appliqué aussi aux jours passés. Aucun objectif de prix.</div>
            {cost.contributions.length > 0 && (
              <ul>{[...cost.contributions].sort((a, b) => b.eur - a.eur).map((row, i) => (
                <li key={`${row.name}-${i}`}><span className="bd-nom">{row.name}</span><span className="bd-val mono">{fmt(row.eur, 2)} €</span></li>
              ))}</ul>
            )}
            {cost.missingNames.length > 0 && <div className="small">Sans prix : {cost.missingNames.join(', ')}</div>}
          </div>
        </div>
      </div>

      <KcalBar consumed={totals.kcal} target={kcalT.optimal} incertitude={incertitude} />
      {date && date < todayStr() && <p className="hint">{dayGoal ? `${calorieGoalLabel(dayGoal)} : ${fmt(dayGoal.kcal)} kcal.` : 'Objectif historique inconnu : repère actuel utilisé pour ce bilan.'}</p>}

      <div className="fold-head">
        <button type="button" className="sec-toggle fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`sec-chevron${open ? ' open' : ''}`} aria-hidden="true">
            ▸
          </span>
          {open ? 'Masquer le détail' : `Voir les ${gridAll.length} nutriments`}
        </button>
        {open && (
          <span className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="small" style={{ color: 'var(--muted)' }}>Trier</span>
            {(['famille', 'urgence'] as GridSort[]).map((opt) => (
              <button
                key={opt}
                className={`small ${sort === opt ? 'chip-active' : 'ghost'}`}
                onClick={() => setSort(opt)}
                data-tip={
                  opt === 'famille'
                    ? 'Ordre de référence : vitamines, minéraux, acides gras… — pour retrouver un nutriment précis'
                    : "Ce qui manque le plus en tête, ce qui est réglé en bas ; un plafond dépassé passe avant tout"
                }
              >
                {opt === 'famille' ? 'par famille' : 'par urgence'}
              </button>
            ))}
          </span>
        )}
      </div>

      {open && (
      <div className="totals-grid" style={{ marginTop: 14 }}>
        {grid.map((t) => {
          const value = displayValue(t.key);

          if (value == null) {
            return (
              <div className="stat has-breakdown" key={t.key} tabIndex={0}>
                <div className="label">{t.label}</div>
                <div className="value mono">inconnu <small>{t.unit}</small></div>
                <div className="small mono">Donnée manquante pour au moins un aliment saisi.</div>
                <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={0} />
              </div>
            );
          }

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
              {t.key === 'cuivre' && copperCoverage.unknownCount > 0 && (
                <div className="small mono">Inconnues comptées à 0 · {copperCoverage.unknownCount} aliment(s)</div>
              )}
              <div className={`bar ${barClass}`}>
                <span style={{ width: `${Math.min(100, pctOpt)}%` }} />
                {distinct && (
                  <i className="mark ajr" style={{ left: `${ajrMark}%` }} data-tip={`AJR ${fmt(t.ajr)} ${t.unit}`} />
                )}
                {t.lowThreshold != null && t.optimal > 0 && (
                  <i
                    className="mark low"
                    style={{ left: `${Math.min(100, (t.lowThreshold / t.optimal) * 100)}%` }}
                    data-tip={`${t.lowLabel ?? 'Seuil de carence documenté'} : ${fmt(t.lowThreshold)} ${t.unit}${t.lowNote ? ` · ${t.lowNote}` : ''}`}
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
                  label={t.lowLabel}
                  note={t.lowNote}
                />
              )}
              {t.key === 'omega3' && <Omega3Breakdown totals={totals} />}
              <Breakdown
                items={items}
                nutrientKey={t.key}
                unit={t.unit}
                total={value}
                vitAReference={t.key === 'vitA' ? { ajr: t.ajr, lowThreshold: t.lowThreshold } : undefined}
              />
            </div>
          );
        })}
      </div>
      )}

      {open && <RatioRow ratios={ratios} />}
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
