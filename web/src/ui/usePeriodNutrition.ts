import { useMemo, useState } from 'react';
import { useStore, todayStr, useEffectiveFoods, isDayCounted } from '../store/store';
import { useTargets } from './useTargets';
import type { Target } from '../nutrition/targets';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { sunVitDForDate } from '../sun/vitaminD';
import { vitaminDFlux } from '../sun/vitaminDStatus';
import {
  resolveRange,
  datesInRange,
  rangeDays,
  defaultPeriodState,
  weighDates,
} from './PeriodSelector';
import type { PeriodState } from './PeriodSelector';
import { decayWeightedTotals, DECAY_HALF_LIFE_DEFAULT } from '../nutrition/recommend';

const KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

/**
 * Chaîne de calcul « période → moyennes journalières » partagée par les onglets
 * Stats et Nutriments. Chaque appelant possède SON propre état de période
 * (préset, inclure aujourd'hui, sans suppléments) : les deux écrans sont donc
 * indépendants. Toute la logique de filtrage (suppléments, jours mutés, jeûne,
 * vitamine D du soleil) vit ici pour rester cohérente entre les deux vues.
 */
export interface PeriodNutrition {
  // État réglable (chaque écran garde le sien).
  period: PeriodState;
  setPeriod: (s: PeriodState) => void;
  includeToday: boolean;
  setIncludeToday: (v: boolean) => void;
  excludeSupplements: boolean;
  setExcludeSupplements: (v: boolean) => void;
  /** Pondération dégressive : les jours récents pèsent plus dans TOUTES les moyennes. */
  decayOn: boolean;
  setDecayOn: (v: boolean) => void;
  /** Demi-vie de la pondération, en jours (un jour de N j pèse moitié moins). */
  halfLife: number;
  setHalfLife: (v: number) => void;

  // Dérivés.
  targets: Target[];
  targetByKey: Map<NutrientKey, Target>;
  /** Totaux/jour bruts (sans soleil), clés = dates enregistrées après filtrage. */
  byDate: Map<string, Nutrients>;
  /** Totaux/jour avec la vitamine D du soleil intégrée. */
  byDateVitD: Map<string, Nutrients>;
  /** Nombre de jours couverts par la plage. */
  days: number;
  /** Dates de la fenêtre (aujourd'hui exclu selon l'option). */
  windowDates: string[];
  /** Jours COMPTÉS de la fenêtre (remplis non mutés + jeûnes démutés). */
  recorded: string[];
  /** Moyenne journalière de chaque nutriment sur les jours comptés. */
  averages: Nutrients;
  /** Statut de flux vitamine D (soleil + alimentation), lissé sur ~4 semaines. */
  vitDStatus: ReturnType<typeof vitaminDFlux>;
}

export function usePeriodNutrition(): PeriodNutrition {
  const entries = useStore((s) => s.entries);
  const sunExposures = useStore((s) => s.sunExposures);
  const mutedDays = useStore((s) => s.mutedDays);
  const targets = useTargets();
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);

  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  /**
   * Par défaut, les moyennes ignorent la journée en cours (non terminée) : sinon
   * un total encore partiel tire artificiellement les moyennes vers le bas.
   */
  const [includeToday, setIncludeToday] = useState(false);
  /**
   * Retire les compléments et assaisonnements (catégorie « supplement ») de
   * toutes les analyses : ce que l'alimentation seule apporte vraiment.
   */
  const [excludeSupplements, setExcludeSupplements] = useState(false);
  /**
   * Pondération dégressive de la période : un jour ancien compte moins qu'un
   * jour récent. Éteinte par défaut — la moyenne simple reste la lecture de
   * référence, la pondérée répond à « où j'en suis EN CE MOMENT ».
   */
  const [decayOn, setDecayOn] = useState(false);
  const [halfLife, setHalfLife] = useState(DECAY_HALF_LIFE_DEFAULT);
  const today = todayStr();

  const foods = useEffectiveFoods();
  const supplementIds = useMemo(
    () => new Set(foods.filter((f) => f.categorie === 'supplement').map((f) => f.id)),
    [foods],
  );

  /**
   * Totaux par jour (tous nutriments) pour tout l'historique. Un jour n'apparaît
   * que s'il reste au moins un item après filtrage : sinon une journée ne
   * contenant QUE des suppléments compterait comme un jour enregistré à zéro et
   * tirerait toutes les moyennes vers le bas.
   */
  const byDate = useMemo(() => {
    const map = new Map<string, Nutrients>();
    for (const e of entries) {
      for (const it of e.items) {
        if (excludeSupplements && it.foodId && supplementIds.has(it.foodId)) continue;
        let t = map.get(e.date);
        if (!t) {
          t = { ...EMPTY_NUTRIENTS };
          map.set(e.date, t);
        }
        for (const k of KEYS) t[k] += it.nutrients[k] ?? 0;
      }
    }
    return map;
  }, [entries, excludeSupplements, supplementIds]);

  /**
   * Totaux par jour avec la vitamine D du SOLEIL intégrée (mêmes jours que `byDate`).
   * La couverture moyenne et la tendance doivent refléter l'apport TOTAL de vitamine D
   * (alimentation + soleil) — sinon la vitamine D paraît artificiellement basse.
   */
  const byDateVitD = useMemo(() => {
    const map = new Map<string, Nutrients>();
    for (const [d, t] of byDate) {
      const sun = sunVitDForDate(sunExposures, d);
      map.set(d, sun > 0 ? { ...t, vitD: t.vitD + sun } : t);
    }
    // Jours de jeûne (vide mais démuté, override `false`) : apports à 0, soleil inclus.
    for (const [d, muted] of Object.entries(mutedDays)) {
      if (muted === false && !byDate.has(d)) {
        map.set(d, { ...EMPTY_NUTRIENTS, vitD: sunVitDForDate(sunExposures, d) });
      }
    }
    return map;
  }, [byDate, sunExposures, mutedDays]);

  /** 1re date enregistrée (borne « Tout »). */
  const earliest = useMemo(() => {
    let min: string | undefined;
    for (const d of byDate.keys()) if (min === undefined || d < min) min = d;
    return min;
  }, [byDate]);

  const range = useMemo(() => resolveRange(period, earliest), [period, earliest]);
  const days = rangeDays(range);
  const windowDates = useMemo(() => {
    const all = datesInRange(range);
    return includeToday ? all : all.filter((d) => d !== today);
  }, [range, includeToday, today]);
  /**
   * Jours COMPTÉS de la fenêtre : jours remplis non mutés + jours de jeûne (vide
   * démuté, override `false`). `isDayCounted` centralise cette règle.
   */
  const recorded = useMemo(
    () => windowDates.filter((d) => isDayCounted(mutedDays, byDate.has(d), d)),
    [windowDates, byDate, mutedDays],
  );

  /**
   * Moyenne journalière de chaque nutriment sur les jours comptés de la fenêtre.
   * Pondération dégressive active, c'est la même moyenne mais avec des poids
   * décroissants vers le passé : le résultat reste homogène à UNE journée, donc
   * comparable aux mêmes cibles journalières — tout ce qui consomme `averages`
   * (couverture, macros, recommandations) suit sans le savoir.
   */
  const averages = useMemo(() => {
    if (recorded.length === 0) return { ...EMPTY_NUTRIENTS };
    if (decayOn) return decayWeightedTotals(weighDates(recorded, byDateVitD, halfLife));
    const a = { ...EMPTY_NUTRIENTS };
    for (const d of recorded) {
      const t = byDateVitD.get(d)!;
      for (const k of KEYS) a[k] += t[k];
    }
    for (const k of KEYS) a[k] /= recorded.length;
    return a;
  }, [recorded, byDateVitD, decayOn, halfLife]);

  /**
   * Apport vitamine D total par jour (alimentation + soleil), tous jours « connus ».
   * On exclut la vitamine D alimentaire des jours remplis mutés ; le soleil reste compté.
   */
  const vitDByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const [d, t] of byDate) if (isDayCounted(mutedDays, true, d)) m.set(d, t.vitD);
    for (const d of new Set(sunExposures.map((e) => e.date))) {
      m.set(d, (m.get(d) ?? 0) + sunVitDForDate(sunExposures, d));
    }
    return m;
  }, [byDate, sunExposures, mutedDays]);

  /** Ancre du flux vitamine D : hier par défaut (journée en cours non terminée), sinon aujourd'hui. */
  const vitDAnchor = includeToday ? today : todayStr(new Date(Date.now() - 86_400_000));
  const vitDStatus = useMemo(() => vitaminDFlux(vitDByDate, vitDAnchor), [vitDByDate, vitDAnchor]);

  return {
    period,
    setPeriod,
    includeToday,
    setIncludeToday,
    excludeSupplements,
    setExcludeSupplements,
    decayOn,
    setDecayOn,
    halfLife,
    setHalfLife,
    targets,
    targetByKey,
    byDate,
    byDateVitD,
    days,
    windowDates,
    recorded,
    averages,
    vitDStatus,
  };
}
