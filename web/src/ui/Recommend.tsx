import { useMemo, useState } from 'react';
import type { Nutrients } from '../nutrition/types';
import type { Target } from '../nutrition/targets';
import { useStore, useEffectiveFoods } from '../store/store';
import { FOODS } from '../nutrition/foods';
import {
  computeGaps,
  rankFoods,
  shortLabel,
  makeImportanceFn,
  RECO_DEFAULTS,
  GAMMA_BOUNDS,
  LAMBDA_BOUNDS,
} from '../nutrition/recommend';
import type { ScoredFood, ScorePart } from '../nutrition/recommend';
import { fmt } from './format';

/** Nombre de lignes affichées par défaut, et pas du bouton « voir plus ». */
const PAGE = 12;

function fmtAmount(v: number): string {
  return fmt(v, v < 10 ? 1 : 0);
}

/** Badge compact d'une contribution : « +Vit C » / « −Na ». */
function PartBadge({ p }: { p: ScorePart }) {
  const neg = p.points < 0;
  return (
    <span
      className="reco-badge mono"
      style={{ color: neg ? 'var(--danger)' : 'var(--accent-2)' }}
      data-tip={`${p.target.label} : ${fmtAmount(p.amount)} ${p.target.unit}${p.reason ? ` (rapport ${p.reason})` : ''}`}
    >
      {neg ? '−' : '+'}{shortLabel(p.key, p.target.label)}
    </span>
  );
}

/** Ligne du classement (compacte, dépliable au clic). */
function ScoredRow({
  s,
  rank,
  maxScore,
  consumed,
  expanded,
  onToggle,
}: {
  s: ScoredFood;
  rank: number;
  maxScore: number;
  consumed: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pts = s.score * 100;
  return (
    <div className={`reco-row ${expanded ? 'open' : ''}`} onClick={onToggle} role="button" tabIndex={0}>
      <div className="reco-line">
        <span className="reco-rank mono">{rank}</span>
        <span className="reco-nom">
          {s.food.nom}
          {consumed && <span className="reco-known" data-tip="Déjà présent dans votre journal">✓</span>}
        </span>
        <span className="reco-badges">
          {s.parts.slice(0, 3).map((p) => (
            <PartBadge key={p.key} p={p} />
          ))}
        </span>
        <span className="reco-pts mono">{fmt(pts)}</span>
      </div>
      <div className="bar" style={{ marginTop: 4, height: 4 }}>
        <span style={{ width: `${maxScore > 0 ? Math.max(0, (s.score / maxScore) * 100) : 0}%` }} />
      </div>
      {expanded && (
        <div className="reco-detail small" onClick={(e) => e.stopPropagation()}>
          <div style={{ marginBottom: 6, opacity: 0.85 }}>
            Portion retenue : <strong className="mono">{fmt(s.portionG, s.portionG < 10 ? 1 : 0)} g</strong>
            {' · '}
            <span className="mono">{fmt(s.kcal)} kcal</span> (les calories ne comptent pas dans le score)
          </div>
          <div className="hc-rows">
            {s.parts.map((p) => (
              <div key={p.key}>
                <span>
                  {p.target.label}
                  {p.reason && <em style={{ opacity: 0.7 }}> · rapport {p.reason}</em>}
                </span>
                <span className="mono" style={{ color: p.points < 0 ? 'var(--danger)' : 'var(--accent-2)' }}>
                  {fmtAmount(p.amount)} {p.target.unit} · {p.points >= 0 ? '+' : ''}{fmt(p.points * 100)} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Recommandations sur la période : suppléments puis classement de tous les
 * aliments de la banque, pondéré par les manques moyens (poids manque^γ,
 * malus λ × excès, rapports intégrés). Interactif : γ, λ et filtre « mes
 * aliments » sont réglables, chaque ligne se déplie pour le détail.
 */
export function Recommendations({
  averages,
  targets,
  hasData,
}: {
  averages: Nutrients;
  targets: Target[];
  hasData: boolean;
}) {
  const entries = useStore((s) => s.entries);
  const nutrientImportance = useStore((s) => s.nutrientImportance);
  const foods = useEffectiveFoods();

  const [gamma, setGamma] = useState(RECO_DEFAULTS.gamma);
  const [lambda, setLambda] = useState(RECO_DEFAULTS.lambda);
  const [includeCatalog, setIncludeCatalog] = useState(false);
  const [count, setCount] = useState(PAGE);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = useMemo(() => ({ gamma, lambda }), [gamma, lambda]);
  const importance = useMemo(() => makeImportanceFn(nutrientImportance), [nutrientImportance]);
  const analysis = useMemo(
    () => computeGaps(averages, targets, params, importance),
    [averages, targets, params, importance],
  );

  /** Aliments déjà rencontrés dans le journal (badge ✓ et filtre « mes aliments »). */
  const consumedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) for (const it of e.items) if (it.foodId) set.add(it.foodId);
    return set;
  }, [entries]);

  /**
   * Le vivier des recommandations : ma banque seule par défaut — conseiller ce
   * qu'on mange déjà est bien plus actionnable qu'un aliment jamais acheté. La
   * case « découvrir » y ajoute le catalogue de référence, pour sortir des
   * habitudes quand aucun aliment de la banque ne comble le manque.
   */
  const pool = useMemo(() => {
    if (!includeCatalog) return foods;
    const mine = new Set(foods.map((f) => f.id));
    return [...foods, ...FOODS.filter((f) => !mine.has(f.id))];
  }, [foods, includeCatalog]);

  const rankedSupplements = useMemo(
    () =>
      rankFoods(pool.filter((f) => f.categorie === 'supplement'), analysis, params)
        .filter((s) => s.score > 0.02)
        .slice(0, 4),
    [pool, analysis, params],
  );

  const rankedFoods = useMemo(
    () => rankFoods(pool.filter((f) => f.categorie !== 'supplement'), analysis, params).filter((s) => s.score > 0),
    [pool, analysis, params],
  );

  const shown = rankedFoods.slice(0, count);
  const maxScore = rankedFoods[0]?.score ?? 0;

  if (!hasData) {
    return (
      <div className="panel">
        <h2>🎯 Recommandations sur la période</h2>
        <div className="empty">Enregistrez des repas sur la période pour obtenir des recommandations.</div>
      </div>
    );
  }

  const topGaps = analysis.gaps.slice(0, 6);

  return (
    <div className="panel">
      <h2>🎯 Recommandations sur la période</h2>
      <p className="small" style={{ marginTop: -6 }}>
        Classement de la banque d'aliments selon vos <strong>manques moyens</strong> sur la période : un aliment gagne
        des points sur chaque nutriment manquant qu'il couvre (poids ∝ manque<sup>γ</sup>, cap au manque restant) et en
        perd sur les excès (sodium, AG saturés, rapports hors zone — force λ). Score par portion habituelle.
      </p>

      {/* Pourquoi ce classement : manques et excès qui pilotent les poids. */}
      {(topGaps.length > 0 || analysis.penalties.length > 0) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0 10px' }}>
          {topGaps.map((g) => (
            <span key={g.key} className="reco-gap mono" data-tip={`${g.target.label} : ${fmtAmount(g.avg)} ${g.target.unit}/j en moyenne, cible ${fmt(g.target.optimal)}${g.ratioBoost ? ` · renforcé par le rapport ${g.ratioBoost}` : ''}`}>
              {shortLabel(g.key, g.target.label)} −{fmt(g.missing * 100)} %{g.ratioBoost ? ' ⚖️' : ''}
            </span>
          ))}
          {analysis.penalties.map((p) => (
            <span key={p.key} className="reco-gap bad mono" data-tip={`${p.target.label} : ${fmtAmount(p.avg)} ${p.target.unit}/j en moyenne${p.reason === 'plafond' ? `, plafond ${fmt(p.cap)}` : ` · rapport ${p.reason}`}`}>
              {shortLabel(p.key, p.target.label)} en excès
            </span>
          ))}
        </div>
      )}

      {rankedSupplements.length > 0 && (
        <>
          <h3 className="reco-h3">💊 Suppléments utiles</h3>
          <div className="reco-list">
            {rankedSupplements.map((s, i) => (
              <ScoredRow
                key={s.food.id}
                s={s}
                rank={i + 1}
                maxScore={rankedSupplements[0].score}
                consumed={consumedIds.has(s.food.id)}
                expanded={expandedId === s.food.id}
                onToggle={() => setExpandedId((id) => (id === s.food.id ? null : s.food.id))}
              />
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 className="reco-h3">🥗 Aliments conseillés</h3>
        <label
          className="row small"
          style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
          data-tip="Élargit les conseils au catalogue de référence, au-delà des aliments que vous mangez déjà"
        >
          <input type="checkbox" checked={includeCatalog} onChange={(e) => setIncludeCatalog(e.target.checked)} />
          Découvrir de nouveaux aliments
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="empty">Aucun aliment ne fait gagner de points — vos manques sont couverts 🎉</div>
      ) : (
        <div className="reco-list">
          {shown.map((s, i) => (
            <ScoredRow
              key={s.food.id}
              s={s}
              rank={i + 1}
              maxScore={maxScore}
              consumed={consumedIds.has(s.food.id)}
              expanded={expandedId === s.food.id}
              onToggle={() => setExpandedId((id) => (id === s.food.id ? null : s.food.id))}
            />
          ))}
        </div>
      )}
      {rankedFoods.length > count && (
        <button style={{ marginTop: 8 }} onClick={() => setCount((c) => c + PAGE)}>
          Voir plus ({rankedFoods.length - count} restants)
        </button>
      )}

      <details className="reco-settings" style={{ marginTop: 12 }}>
        <summary className="small">⚙️ Réglages du classement</summary>
        <div className="reco-sliders">
          <label className="small">
            Progressivité des manques — γ = <strong className="mono">{fmt(gamma, 1)}</strong>
            <input
              type="range"
              min={GAMMA_BOUNDS.min}
              max={GAMMA_BOUNDS.max}
              step={GAMMA_BOUNDS.step}
              value={gamma}
              onChange={(e) => setGamma(Number(e.target.value))}
            />
            <span className="hint" style={{ marginTop: 2 }}>
              À 1, le poids d'un nutriment est proportionnel à son manque ; plus γ monte, plus les gros manques
              dominent les petits.
            </span>
          </label>
          <label className="small">
            Force du négatif — λ = <strong className="mono">{fmt(lambda, 2)}</strong>
            <input
              type="range"
              min={LAMBDA_BOUNDS.min}
              max={LAMBDA_BOUNDS.max}
              step={LAMBDA_BOUNDS.step}
              value={lambda}
              onChange={(e) => setLambda(Number(e.target.value))}
            />
            <span className="hint" style={{ marginTop: 2 }}>
              À 0, les excès (sodium, AG saturés, ω6…) sont ignorés ; à 3, un aliment salé ou saturé plonge dans le
              classement même s'il couvre des manques.
            </span>
          </label>
        </div>
      </details>
    </div>
  );
}
