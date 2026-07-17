import { useMemo } from 'react';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import type { JournalItem } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import { useStore } from '../store/store';
import type { KcalUncertainty } from '../nutrition/uncertainty';
import { UncertaintyBadge } from './UncertaintyBadge';
import { fmt } from './format';

interface Contribution {
  nom: string;
  amount: number;
}

/**
 * Principaux aliments du jour apportant un nutriment donné, du plus au moins
 * contributeur. Les items sont regroupés par nom affiché (deux entrées du même
 * aliment se cumulent).
 */
function topContributors(items: JournalItem[], key: NutrientKey, limit = 6): Contribution[] {
  const byName = new Map<string, number>();
  for (const it of items) {
    const v = it.nutrients[key];
    if (v > 0) byName.set(it.nomAffiche, (byName.get(it.nomAffiche) ?? 0) + v);
  }
  return [...byName.entries()]
    .map(([nom, amount]) => ({ nom, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
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
  const contribs = useMemo(() => topContributors(items, nutrientKey), [items, nutrientKey]);
  return (
    <div className="breakdown" role="tooltip">
      <div className="bd-title">Principaux apports</div>
      {contribs.length === 0 ? (
        <div className="bd-empty">Aucun apport aujourd'hui.</div>
      ) : (
        <ul>
          {contribs.map((c) => (
            <li key={c.nom}>
              <span className="bd-nom">{c.nom}</span>
              <span className="bd-val mono">
                {fmt(c.amount, c.amount < 10 ? 1 : 0)} {unit}
                {total > 0 && <span className="bd-pct"> · {fmt((c.amount / total) * 100)}%</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Répartition ALA/EPA/DHA sous la tuile oméga-3 : l'ALA (végétal) est affiché
 * en valeur brute ET en équivalent pondéré (÷10, mal converti par le corps),
 * seul celui-ci comptant dans la cible/le score/les rapports. EPA et DHA
 * (marins/animaux) comptent pour leur valeur brute.
 */
export function Omega3Breakdown({ totals }: { totals: Nutrients }) {
  const { omega3Ala, omega3Epa, omega3Dha } = totals;
  if (omega3Ala <= 0 && omega3Epa <= 0 && omega3Dha <= 0) return null;
  return (
    <div className="small mono" style={{ marginTop: 2, opacity: 0.75 }}>
      dont ALA {fmt(omega3Ala, 1)} g (≈ {fmt(omega3Ala / 10, 2)} g éq.) · EPA {fmt(omega3Epa, 1)} g · DHA{' '}
      {fmt(omega3Dha, 1)} g
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
}: {
  totals: Nutrients;
  items: JournalItem[];
  /** Incertitude ± kcal du jour (badge « ~ » discret sur la barre de calories). */
  incertitude?: KcalUncertainty;
}) {
  const profile = useStore((s) => s.profile);
  const targets = useMemo(() => computeTargets(profile), [profile]);

  const kcalT = targets.find((t) => t.key === 'kcal')!;
  const headline = targets.filter((t) =>
    ['proteines', 'glucides', 'lipides', 'fibres'].includes(t.key),
  );
  const grid = targets.filter((t) => t.key !== 'kcal');
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
                  <i className="mark opti" style={{ left: `${optMark}%` }} title={`Idéal ≤ ${fmt(t.optimal)} ${t.unit}`} />
                </div>
                <div className="small mono">
                  {fmt(pct)}% du plafond · idéal ≤ {fmt(t.optimal)} / max {fmt(t.ajr)}
                </div>
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
                  <i className="mark ajr" style={{ left: `${ajrMark}%` }} title={`AJR ${fmt(t.ajr)} ${t.unit}`} />
                )}
              </div>
              <div className="small mono">
                {fmt(pctOpt)}%{' '}
                {distinct ? `· AJR ${fmt(t.ajr)} / opti ${fmt(t.optimal)}` : `· AJR ${fmt(t.ajr)}`}
              </div>
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
        Rapports du jour · survolez pour le détail (aussi dans l'onglet Guide)
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
