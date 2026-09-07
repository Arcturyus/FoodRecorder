import { useMemo, useState } from 'react';
import { useStore, useEffectiveFoods } from '../store/store';
import { useTargets } from './useTargets';
import type { Target } from '../nutrition/targets';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { resolveRange, rangeDays, defaultPeriodState } from './PeriodSelector';
import type { PeriodState } from './PeriodSelector';
import { DECAY_HALF_LIFE_DEFAULT } from '../nutrition/recommend';
import { computePeriodNutrition } from '../nutrition/periodNutrition';
import { vitaminDFlux } from '../sun/vitaminDStatus';

export interface PeriodNutrition {
  period: PeriodState; setPeriod: (s: PeriodState) => void;
  includeToday: boolean; setIncludeToday: (v: boolean) => void;
  excludeSupplements: boolean; setExcludeSupplements: (v: boolean) => void;
  decayOn: boolean; setDecayOn: (v: boolean) => void;
  halfLife: number; setHalfLife: (v: number) => void;
  targets: Target[]; targetByKey: Map<NutrientKey, Target>;
  byDate: Map<string, Nutrients>; byDateVitD: Map<string, Nutrients>;
  days: number; windowDates: string[]; recorded: string[]; averages: Nutrients;
  vitDStatus: ReturnType<typeof vitaminDFlux>;
}

export function usePeriodNutrition(): PeriodNutrition {
  const entries = useStore((s) => s.entries);
  const sunExposures = useStore((s) => s.sunExposures);
  const mutedDays = useStore((s) => s.mutedDays);
  const foods = useEffectiveFoods();
  const targets = useTargets();
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  const [includeToday, setIncludeToday] = useState(false);
  const [excludeSupplements, setExcludeSupplements] = useState(false);
  const [decayOn, setDecayOn] = useState(false);
  const [halfLife, setHalfLife] = useState(DECAY_HALF_LIFE_DEFAULT);
  const earliest = useMemo(() => {
    const supplementIds = new Set(foods.filter((food) => food.categorie === 'supplement').map((food) => food.id));
    return entries.reduce<string | undefined>((min, entry) => {
      const retained = !excludeSupplements || entry.items.some((item) => !item.foodId || !supplementIds.has(item.foodId));
      return retained && (min == null || entry.date < min) ? entry.date : min;
    }, undefined);
  }, [entries, foods, excludeSupplements]);
  const range = useMemo(() => resolveRange(period, earliest), [period, earliest]);
  const computed = useMemo(() => computePeriodNutrition(
    { entries, sunExposures, mutedDays, foods },
    { range, includeToday, excludeSupplements, includeSun: true, decayOn, halfLife },
  ), [entries, sunExposures, mutedDays, foods, range, includeToday, excludeSupplements, decayOn, halfLife]);
  return { period, setPeriod, includeToday, setIncludeToday, excludeSupplements, setExcludeSupplements, decayOn, setDecayOn, halfLife, setHalfLife, targets, targetByKey, days: rangeDays(range), ...computed };
}
