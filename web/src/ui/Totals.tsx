import { useMemo } from 'react';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import type { JournalItem } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import { useStore } from '../store/store';
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
 * Bilan du jour : kcal + macros en tête, puis grille de tous les nutriments avec
 * une barre de progression vers la cible « optimale » et un repère sur l'AJR.
 * Chaque tuile est survolable (ou tapable) pour voir les aliments qui apportent
 * le plus de ce nutriment.
 */
export function Totals({ totals, items }: { totals: Nutrients; items: JournalItem[] }) {
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
              <Breakdown items={items} nutrientKey={t.key} unit={t.unit} total={value} />
            </div>
          );
        })}
      </div>

      <RatioRow ratios={ratios} />
    </div>
  );
}

const RATIO_STATUS_COLOR: Record<string, string> = {
  good: 'var(--accent-2)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  na: 'var(--muted)',
};

/** Rapports optimaux du jour (oméga-6/3, potassium/sodium, calcium/magnésium). */
function RatioRow({ ratios }: { ratios: RatioResult[] }) {
  return (
    <div className="ratio-row" style={{ marginTop: 16 }}>
      <div className="small" style={{ marginBottom: 8, opacity: 0.8 }}>
        Rapports du jour · détail et cibles dans l'onglet Guide
      </div>
      <div className="totals-grid">
        {ratios.map((r) => (
          <div className="stat" key={r.def.key} title={r.def.note}>
            <div className="label">{r.def.label}</div>
            <div className="value mono" style={{ color: RATIO_STATUS_COLOR[r.status] }}>
              {r.text}
            </div>
            <div className="small mono">
              {r.def.better === 'higher'
                ? `idéal ≥ ${fmt(r.def.optimal)}${r.def.suffix}`
                : r.def.better === 'lower'
                  ? `idéal ≤ ${fmt(r.def.optimal)}${r.def.suffix}`
                  : `idéal ≈ ${fmt(r.def.optimal)}${r.def.suffix}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
