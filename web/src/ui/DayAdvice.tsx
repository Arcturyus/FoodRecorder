import { useMemo, useState } from 'react';
import type { Nutrients } from '../nutrition/types';
import { useStore, useEffectiveFoods } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import {
  dayAdvice,
  macroAdvice,
  DAY_MIN_PROGRESS,
  DAY_FOOD_SUGGESTIONS,
  MACRO_MAX_SUGGESTIONS,
  makeImportanceFn,
} from '../nutrition/recommend';
import type { DayAdviceItem, Suggestion, MacroAdvice, MacroSuggestion } from '../nutrition/recommend';
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
 * Fait défiler une liste de suggestions par pages : l'écran n'en montre qu'une,
 * et « ⟳ Autres » passe à la suivante (retour au début en fin de liste). Sert
 * quand aucune des propositions ne convient — pas envie, rien de ça au frigo —
 * sans pour autant afficher un mur d'aliments.
 */
function useSuggestionPage<T>(all: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = page % pages; // la liste peut rétrécir entre deux rendus
  return {
    shown: all.slice(current * pageSize, (current + 1) * pageSize),
    pages,
    page: current,
    next: () => setPage((p) => (p + 1) % pages),
  };
}

/** Bouton « ⟳ Autres » d'une rangée de suggestions (masqué s'il n'y a qu'une page). */
function MoreSuggestions({ page, pages, onNext }: { page: number; pages: number; onNext: () => void }) {
  if (pages <= 1) return null;
  return (
    <button
      className="ghost small advice-more"
      onClick={onNext}
      data-tip="Aucun ne vous convient ? En proposer d'autres qui comblent le même manque"
    >
      ⟳ Autres <span className="mono" style={{ opacity: 0.6 }}>{page + 1}/{pages}</span>
    </button>
  );
}

const MACRO_TONE_ICON: Record<MacroAdvice['tone'], string> = {
  lean: '🥩',
  balanced: '🍽️',
  protDone: '✅',
};

/** Chip d'une suggestion macro : « Poulet (150 g → 35 g prot · 250 kcal) », ✓ si déjà mangé. */
function MacroChip({ s, known }: { s: MacroSuggestion; known: boolean }) {
  return (
    <span className="advice-chip" data-tip={known ? 'Déjà présent dans votre journal' : undefined}>
      {s.food.nom}{known && <span className="advice-known">✓</span>}
      <span className="mono small" style={{ opacity: 0.75 }}>
        {' '}({fmt(s.portionG, s.portionG < 10 ? 1 : 0)} g → {fmt(s.prot, s.prot < 10 ? 1 : 0)} g prot · {fmt(s.kcal, 0)} kcal)
      </span>
    </span>
  );
}

/** Section « compléter tes macros » : calories/protéines restantes + aliments adaptés. */
function MacroSection({ macro, consumedIds }: { macro: MacroAdvice; consumedIds: Set<string> }) {
  const sugg = useSuggestionPage(macro.suggestions, MACRO_MAX_SUGGESTIONS);
  return (
    <div className="advice-item advice-macro">
      <div className="small">
        {MACRO_TONE_ICON[macro.tone]} {macro.text}
      </div>
      {macro.laggingMacros.length > 0 && (
        <div className="small" style={{ opacity: 0.8, marginTop: 3 }}>
          En retard aussi :{' '}
          {macro.laggingMacros
            .map((m) => `${m.target.label} (~${fmt(m.remaining, m.remaining < 10 ? 1 : 0)} ${m.target.unit})`)
            .join(' · ')}
          .
        </div>
      )}
      {macro.suggestions.length > 0 && (
        <div className="row advice-sugg" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {sugg.shown.map((s) => (
            <MacroChip key={s.food.id} s={s} known={consumedIds.has(s.food.id)} />
          ))}
          <MoreSuggestions page={sugg.page} pages={sugg.pages} onNext={sugg.next} />
        </div>
      )}
    </div>
  );
}

/** Une alerte micronutriment : situation + suppléments/aliments qui la corrigent. */
function AdviceItemCard({ it, consumedIds }: { it: DayAdviceItem; consumedIds: Set<string> }) {
  const sugg = useSuggestionPage(it.foodSuggestions, DAY_FOOD_SUGGESTIONS);
  return (
    <div className="advice-item">
      <div className="small">
        {KIND_ICON[it.kind]} <strong>{it.target?.label ?? it.ratioLabel}</strong> — {it.text}
      </div>
      {(it.supplements.length > 0 || it.foodSuggestions.length > 0) && (
        <div className="row advice-sugg" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {it.supplements.map((s) => (
            <SuggestionChip key={s.food.id} s={s} unit={it.target?.unit ?? ''} icon="💊" known={consumedIds.has(s.food.id)} />
          ))}
          {sugg.shown.map((s) => (
            <SuggestionChip key={s.food.id} s={s} unit={it.target?.unit ?? it.suggestionUnit ?? ''} known={consumedIds.has(s.food.id)} />
          ))}
          <MoreSuggestions page={sugg.page} pages={sugg.pages} onNext={sugg.next} />
        </div>
      )}
    </div>
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
  const macro = useMemo(
    () => macroAdvice(totals, targets, foods, consumedIds, importance),
    [totals, targets, foods, consumedIds, importance],
  );

  // La section macros (kcal/protéines restantes) n'est pas soumise au seuil
  // des 30 % : elle est utile dès la première entrée de la journée. Les
  // alertes micronutriments (items), elles, restent masquées avant ce seuil.
  if (!macro && progress < DAY_MIN_PROGRESS) return null;

  const nothing = !macro && items.length === 0;

  return (
    <div className="panel">
      <h2>💡 Conseils du jour</h2>
      {nothing ? (
        <div className="small" style={{ opacity: 0.8 }}>✅ Rien d'alarmant pour l'instant — la journée suit les objectifs.</div>
      ) : (
        <>
          {macro && (
            <>
              <h3 className="advice-subhead">🍗 Compléter tes macros</h3>
              <MacroSection macro={macro} consumedIds={consumedIds} />
            </>
          )}
          {items.length > 0 ? (
            <>
              {macro && <h3 className="advice-subhead">🔬 Micronutriments &amp; équilibre</h3>}
              <div className="advice-list">
                {items.map((it, i) => (
                  <AdviceItemCard key={`${it.target?.key ?? it.ratioLabel ?? i}`} it={it} consumedIds={consumedIds} />
                ))}
              </div>
            </>
          ) : macro && progress < DAY_MIN_PROGRESS ? (
            <>
              <h3 className="advice-subhead">🔬 Micronutriments &amp; équilibre</h3>
              <div className="small" style={{ opacity: 0.7 }}>
                ⏳ Conseils micronutriments disponibles à partir de 30 % des calories du jour (actuellement{' '}
                {fmt(progress * 100)} %).
              </div>
            </>
          ) : null}
        </>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        Basé sur la journée en cours, rapportée à son avancement calorique ({fmt(Math.min(100, progress * 100))} % de
        l'objectif). L'analyse complète sur plusieurs jours est dans l'onglet Stats.
      </div>
    </div>
  );
}
