import { useMemo, useState } from 'react';
import type { Nutrients, NutrientKey } from '../nutrition/types';
import { useStore, useEffectiveFoods, dayTotals, isDayCounted, todayStr } from '../store/store';
import { useTargets } from './useTargets';
import type { Target } from '../nutrition/targets';
import { sunVitDForDate } from '../sun/vitaminD';
import {
  dayAdvice,
  macroAdvice,
  DAY_MIN_PROGRESS,
  DAY_FOOD_SUGGESTIONS,
  MACRO_MAX_SUGGESTIONS,
  makeImportanceFn,
  lowestCoverage,
  decayWeight,
  decayWindowDays,
  decayWeightedTotals,
  DECAY_HALF_LIFE_DEFAULT,
} from '../nutrition/recommend';
import type {
  DayAdviceItem,
  Suggestion,
  MacroAdvice,
  MacroSuggestion,
  AdviceScope,
  WeightedDay,
  LowCoverage,
} from '../nutrition/recommend';
import { HalfLifeSelector, shiftDays } from './PeriodSelector';
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
function AdviceItemCard({
  it,
  consumedIds,
  exceeded,
}: {
  it: DayAdviceItem;
  consumedIds: Set<string>;
  /** Plafonds : « dépassé N jours sur M » de la fenêtre (mode « derniers jours »). */
  exceeded?: { days: number; total: number };
}) {
  const sugg = useSuggestionPage(it.foodSuggestions, DAY_FOOD_SUGGESTIONS);
  return (
    <div className="advice-item">
      <div className="small">
        {KIND_ICON[it.kind]} <strong>{it.target?.label ?? it.ratioLabel}</strong> — {it.text}
      </div>
      {exceeded && (
        <div
          className="small"
          style={{ opacity: 0.8, marginTop: 3 }}
          data-tip="Une moyenne peut cacher un seul jour très excessif : ce compte dit si le dépassement est régulier ou isolé."
        >
          Plafond dépassé <strong>{exceeded.days} jour(s) sur {exceeded.total}</strong>.
        </div>
      )}
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
 * « Les plus bas en ce moment » : classement compact des nutriments les moins
 * couverts, avec pour chacun la meilleure source alimentaire. Toujours présent,
 * même quand rien ne déclenche d'alerte — c'est ce qui manque *relativement*,
 * pas ce qui est alarmant.
 */
function LowestBlock({ lows, scope, consumedIds }: { lows: LowCoverage[]; scope: AdviceScope; consumedIds: Set<string> }) {
  if (lows.length === 0) {
    return (
      <div className="advice-item small" style={{ opacity: 0.8 }}>
        ✅ Tous les nutriments suivis sont au-dessus de leur cible
        {scope === 'jour' ? ' au rythme de la journée' : ' en moyenne'}.
      </div>
    );
  }
  return (
    <div className="advice-item">
      <div className="small" style={{ color: 'var(--muted)', marginBottom: 6 }}>
        📊 Les plus bas {scope === 'jour' ? 'à cet instant' : 'en ce moment'} — classés par manque × importance, et
        l'aliment le plus riche pour chacun.
      </div>
      <div className="low-list">
        {lows.map((l) => {
          const pct = Math.round(Math.min(1, l.coverage) * 100);
          return (
            <div key={l.target.key} className="low-row">
              <span className="low-name small">{l.target.label}</span>
              <span className="low-bar" data-tip={`${fmt(l.value, l.value < 10 ? 1 : 0)} ${l.target.unit} sur ${fmt(l.target.optimal, l.target.optimal < 10 ? 1 : 0)} ${l.target.unit} visés`}>
                <span className="low-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="mono small low-pct">{pct} %</span>
              {l.best && (
                <span className="advice-chip low-food" data-tip={consumedIds.has(l.best.food.id) ? 'Déjà présent dans votre journal' : undefined}>
                  {l.best.food.nom}
                  {consumedIds.has(l.best.food.id) && <span className="advice-known">✓</span>}
                  <span className="mono small" style={{ opacity: 0.75 }}>
                    {' '}({fmt(l.best.portionG, l.best.portionG < 10 ? 1 : 0)} g → {fmt(l.best.amount, l.best.amount < 10 ? 1 : 0)} {l.target.unit})
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fenêtre pondérée « ces derniers jours »
// ---------------------------------------------------------------------------

/**
 * Fenêtre pondérée précédant `anchor` : les `decayWindowDays(halfLife)` jours
 * qui le précèdent, jours non comptés (mutés, non remplis) exclus, vitamine D du
 * soleil incluse comme dans le bilan du jour.
 *
 * Le jour d'ancrage lui-même est HORS fenêtre : encore en cours, il tirerait
 * mécaniquement la moyenne vers le bas et ferait bouger le conseil à chaque
 * repas saisi. Le mode « Aujourd'hui » reste là pour la journée courante.
 */
function useRecentDays(anchor: string, halfLife: number): WeightedDay[] {
  const entries = useStore((s) => s.entries);
  const mutedDays = useStore((s) => s.mutedDays);
  const sunExposures = useStore((s) => s.sunExposures);
  return useMemo(() => {
    const filled = new Set(entries.map((e) => e.date));
    const out: WeightedDay[] = [];
    for (let age = 1; age <= decayWindowDays(halfLife); age++) {
      const date = shiftDays(anchor, age);
      if (!isDayCounted(mutedDays, filled.has(date), date)) continue;
      const t = dayTotals(entries, date);
      const sun = sunVitDForDate(sunExposures, date);
      out.push({
        date,
        weight: decayWeight(age, halfLife),
        totals: sun > 0 ? { ...t, vitD: t.vitD + sun } : t,
      });
    }
    return out;
  }, [entries, mutedDays, sunExposures, anchor, halfLife]);
}

/** Pour chaque nutriment « limite », le nombre de jours de la fenêtre au-dessus du plafond. */
function countExceededDays(days: WeightedDay[], targets: Target[]): Map<NutrientKey, number> {
  const m = new Map<NutrientKey, number>();
  for (const t of targets) {
    if (t.goal !== 'limit' || t.ajr <= 0) continue;
    m.set(t.key, days.filter((d) => (d.totals[t.key] ?? 0) > t.ajr).length);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Corps commun : sections macros + micronutriments pour un total donné
// ---------------------------------------------------------------------------

/**
 * Rendu des conseils pour UN total journalier — celui du jour ou une moyenne
 * pondérée. Tout le moteur (`macroAdvice`, `dayAdvice`) est le même : seule la
 * portée change, ce qui garantit que les deux modes disent la même chose des
 * mêmes chiffres.
 */
function AdviceBody({
  totals,
  scope,
  exceeded,
  windowSize,
  gate,
}: {
  totals: Nutrients;
  scope: AdviceScope;
  /** Jours dépassés par nutriment « limite » (mode « derniers jours »). */
  exceeded?: Map<NutrientKey, number>;
  /** Nombre de jours réellement agrégés (dénominateur du « N jours sur M »). */
  windowSize?: number;
  /**
   * Seuil d'avancement de la journée : en portée « jour », les alertes
   * micronutriments restent masquées tant que la journée est trop peu avancée.
   */
  gate?: { progress: number };
}) {
  const entries = useStore((s) => s.entries);
  const nutrientImportance = useStore((s) => s.nutrientImportance);
  const foods = useEffectiveFoods();
  const targets = useTargets();
  const importance = useMemo(() => makeImportanceFn(nutrientImportance), [nutrientImportance]);

  /** Aliments déjà mangés (tout l'historique) : priorité aux suggestions déjà connues. */
  const consumedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) for (const it of e.items) if (it.foodId) set.add(it.foodId);
    return set;
  }, [entries]);

  const items = useMemo(
    () => dayAdvice(totals, targets, foods, consumedIds, importance, scope),
    [totals, targets, foods, consumedIds, importance, scope],
  );
  const macro = useMemo(
    () => macroAdvice(totals, targets, foods, consumedIds, importance, scope),
    [totals, targets, foods, consumedIds, importance, scope],
  );

  const lows = useMemo(
    () => lowestCoverage(totals, targets, foods, importance, scope),
    [totals, targets, foods, importance, scope],
  );

  /**
   * Avant 30 % des calories du jour, les couvertures ne veulent rien dire : un
   * seul petit-déjeuner mettrait tout le monde « très bas ». On le DIT, au lieu
   * de faire disparaître la section.
   */
  const belowGate = gate != null && gate.progress < DAY_MIN_PROGRESS;

  return (
    <>
      {macro && (
        <>
          <h3 className="advice-subhead">🍗 Compléter tes macros</h3>
          <MacroSection macro={macro} consumedIds={consumedIds} />
        </>
      )}
      <h3 className="advice-subhead">🔬 Micronutriments &amp; équilibre</h3>
      {belowGate ? (
        <div className="small" style={{ opacity: 0.7 }}>
          ⏳ Conseils micronutriments disponibles à partir de 30 % des calories du jour (actuellement{' '}
          {fmt(gate!.progress * 100)} %).
        </div>
      ) : (
        <div className="advice-list">
          <LowestBlock lows={lows} scope={scope} consumedIds={consumedIds} />
          {items.length > 0 ? (
            items.map((it, i) => {
              const days = it.kind === 'excess' && it.target ? exceeded?.get(it.target.key) : undefined;
              return (
                <AdviceItemCard
                  key={`${it.target?.key ?? it.ratioLabel ?? i}`}
                  it={it}
                  consumedIds={consumedIds}
                  exceeded={days != null && windowSize ? { days, total: windowSize } : undefined}
                />
              );
            })
          ) : (
            <div className="small" style={{ opacity: 0.7 }}>
              ✅ Aucune alerte : aucun plafond dépassé, aucun rapport hors zone, rien sous 45 % du rythme attendu.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Carte de l'écran Aujourd'hui (bascule jour ↔ derniers jours)
// ---------------------------------------------------------------------------

/**
 * Conseils : les points les plus « choquants » de la journée en cours (plafond
 * dépassé, rapport hors zone, nutriment très en retard), classés par sévérité —
 * avec pour chacun le supplément et/ou plusieurs aliments variés (catégories
 * différentes, dont un déjà connu si possible) qui règlent le problème.
 *
 * Une bascule change la carte ENTIÈRE de portée : « Ces derniers jours »
 * remplace le total du jour par une moyenne pondérée des journées précédentes
 * (le récent pèse plus, demi-vie réglable). Un manque installé — « vous étiez en
 * manque de X ces derniers jours » — ne se voit pas sur une seule journée, qui
 * peut être bonne ou mauvaise par hasard.
 */
export function DayAdviceCard({ totals, date }: { totals: Nutrients; date?: string }) {
  const targets = useTargets();

  const [scope, setScope] = useState<AdviceScope>('jour');
  const [halfLife, setHalfLife] = useState(DECAY_HALF_LIFE_DEFAULT);

  const anchor = date ?? todayStr();
  const recentDays = useRecentDays(anchor, halfLife);
  const recentTotals = useMemo(() => decayWeightedTotals(recentDays), [recentDays]);
  const exceeded = useMemo(() => countExceededDays(recentDays, targets), [recentDays, targets]);

  const kcalT = targets.find((t) => t.key === 'kcal');
  const progress = kcalT && kcalT.optimal > 0 ? totals.kcal / kcalT.optimal : 0;

  // La carte disparaît quand la journée est trop peu avancée pour être jugée —
  // sauf en mode « derniers jours », qui ne parle pas de la journée en cours.
  const macroWorthShowing = totals.kcal > 0;
  if (scope === 'jour' && !macroWorthShowing && progress < DAY_MIN_PROGRESS) return null;

  const scopeSwitch = (
    <div className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        className={`small ${scope === 'jour' ? 'chip-active' : 'ghost'}`}
        onClick={() => setScope('jour')}
        data-tip="Conseils sur la seule journée affichée"
      >
        {anchor === todayStr() ? "Aujourd'hui" : 'Ce jour'}
      </button>
      <button
        className={`small ${scope === 'recents' ? 'chip-active' : 'ghost'}`}
        onClick={() => setScope('recents')}
        data-tip="Conseils sur une moyenne pondérée des jours précédents : les manques installés, plutôt que les hasards d'une journée"
      >
        Ces derniers jours
      </button>
      {scope === 'recents' && <HalfLifeSelector value={halfLife} onChange={setHalfLife} />}
    </div>
  );

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>💡 Conseils {scope === 'jour' ? 'du jour' : 'des derniers jours'}</h2>
        {scopeSwitch}
      </div>
      <div style={{ marginTop: 8 }}>
        {scope === 'recents' && recentDays.length === 0 ? (
          <div className="small" style={{ opacity: 0.8 }}>
            Aucun jour enregistré dans les {decayWindowDays(halfLife)} jours précédents — rien à moyenner.
          </div>
        ) : (
          <AdviceBody
            key={scope}
            totals={scope === 'jour' ? totals : recentTotals}
            scope={scope}
            exceeded={exceeded}
            windowSize={recentDays.length}
            gate={scope === 'jour' ? { progress } : undefined}
          />
        )}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {scope === 'jour' ? (
          <>
            Basé sur la journée en cours, rapportée à son avancement calorique (
            {fmt(Math.min(100, progress * 100))} % de l'objectif). L'analyse complète sur plusieurs jours est dans
            l'onglet Stats.
          </>
        ) : (
          <>
            Moyenne pondérée des {recentDays.length} jour(s) enregistré(s) parmi les {decayWindowDays(halfLife)}{' '}
            précédents (demi-vie {halfLife} j : hier compte ~{fmt(decayWeight(1, halfLife) * 100, 0)} %, il y a une
            semaine ~{fmt(decayWeight(7, halfLife) * 100, 0)} %). La journée en cours est exclue : incomplète, elle
            tirerait la moyenne vers le bas.
          </>
        )}
      </div>
    </div>
  );
}

