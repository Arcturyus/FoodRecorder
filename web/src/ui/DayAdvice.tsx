import { useMemo } from 'react';
import type { Nutrients } from '../nutrition/types';
import { useStore, useEffectiveFoods } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import { dayAdvice, DAY_MIN_PROGRESS, makeImportanceFn } from '../nutrition/recommend';
import type { DayAdviceItem, Suggestion } from '../nutrition/recommend';
import { fmt } from './format';

const KIND_ICON: Record<DayAdviceItem['kind'], string> = {
  excess: '⛔',
  ratio: '⚖️',
  deficit: '📉',
};

/** Une suggestion inline : « Sardines (100 g → 1,5 g) », marquée ✓ si déjà mangée. */
function SuggestionChip({ s, unit, icon, known }: { s: Suggestion; unit: string; icon?: string; known: boolean }) {
  return (
    <span className="advice-chip" data-tip={known ? 'Déjà présent dans votre journal' : undefined}>
      {icon}{icon && ' '}{s.food.nom}{known && <span className="advice-known">✓</span>}
      <span className="mono small" style={{ opacity: 0.75 }}>
        {' '}({fmt(s.portionG, s.portionG < 10 ? 1 : 0)} g → {fmt(s.amount, s.amount < 10 ? 1 : 0)} {unit})
      </span>
    </span>
  );
}

/**
 * Conseils du jour : les points les plus « choquants » de la journée en cours
 * (plafond dépassé, rapport hors zone, nutriment très en retard), classés par
 * sévérité — avec pour chacun le supplément et/ou plusieurs aliments variés
 * (catégories différentes, dont un déjà connu si possible) qui règlent le
 * problème. Invisible tant que la journée est trop peu avancée pour juger.
 */
export function DayAdviceCard({ totals }: { totals: Nutrients }) {
  const profile = useStore((s) => s.profile);
  const entries = useStore((s) => s.entries);
  const nutrientImportance = useStore((s) => s.nutrientImportance);
  const foods = useEffectiveFoods();
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const importance = useMemo(() => makeImportanceFn(nutrientImportance), [nutrientImportance]);

  /** Aliments déjà mangés (tout l'historique) : priorité aux suggestions déjà connues. */
  const consumedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) for (const it of e.items) if (it.foodId) set.add(it.foodId);
    return set;
  }, [entries]);

  const kcalT = targets.find((t) => t.key === 'kcal');
  const progress = kcalT && kcalT.optimal > 0 ? totals.kcal / kcalT.optimal : 0;
  const items = useMemo(
    () => dayAdvice(totals, targets, foods, consumedIds, importance),
    [totals, targets, foods, consumedIds, importance],
  );

  if (progress < DAY_MIN_PROGRESS) return null;

  return (
    <div className="panel">
      <h2>💡 Conseils du jour</h2>
      {items.length === 0 ? (
        <div className="small" style={{ opacity: 0.8 }}>✅ Rien d'alarmant pour l'instant — la journée suit les objectifs.</div>
      ) : (
        <div className="advice-list">
          {items.map((it, i) => (
            <div className="advice-item" key={i}>
              <div className="small">
                {KIND_ICON[it.kind]} <strong>{it.target?.label ?? it.ratioLabel}</strong> — {it.text}
              </div>
              {(it.supplements.length > 0 || it.foodSuggestions.length > 0) && (
                <div className="row advice-sugg" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {it.supplements.map((s) => (
                    <SuggestionChip key={s.food.id} s={s} unit={it.target?.unit ?? ''} icon="💊" known={consumedIds.has(s.food.id)} />
                  ))}
                  {it.foodSuggestions.map((s) => (
                    <SuggestionChip key={s.food.id} s={s} unit={it.target?.unit ?? it.suggestionUnit ?? ''} known={consumedIds.has(s.food.id)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        Basé sur la journée en cours, rapportée à son avancement calorique ({fmt(Math.min(100, progress * 100))} % de
        l'objectif). L'analyse complète sur plusieurs jours est dans l'onglet Stats.
      </div>
    </div>
  );
}
