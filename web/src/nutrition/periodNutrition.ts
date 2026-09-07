import type { JournalEntry } from '../store/store';
import { isDayCounted, todayStr } from '../store/store';
import type { Food, NutrientKey, Nutrients } from './types';
import { EMPTY_NUTRIENTS } from './types';
import type { SunExposure } from '../sun/vitaminD';
import { sunVitDForDate } from '../sun/vitaminD';
import { vitaminDFlux } from '../sun/vitaminDStatus';
import { datesInRange, weighDates } from '../ui/PeriodSelector';
import type { DateRange } from '../ui/PeriodSelector';
import { decayWeightedTotals } from './recommend';

const KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

export interface PeriodNutritionInput {
  entries: JournalEntry[];
  sunExposures: SunExposure[];
  mutedDays: Record<string, boolean>;
  foods: Food[];
}

export interface PeriodNutritionOptions {
  range: DateRange;
  includeToday: boolean;
  excludeSupplements: boolean;
  includeSun: boolean;
  decayOn: boolean;
  halfLife: number;
}

export function computePeriodNutrition(input: PeriodNutritionInput, options: PeriodNutritionOptions) {
  const supplementIds = new Set(input.foods.filter((f) => f.categorie === 'supplement').map((f) => f.id));
  const byDate = new Map<string, Nutrients>();
  for (const entry of input.entries) for (const item of entry.items) {
    if (options.excludeSupplements && item.foodId && supplementIds.has(item.foodId)) continue;
    let total = byDate.get(entry.date);
    if (!total) { total = { ...EMPTY_NUTRIENTS }; byDate.set(entry.date, total); }
    for (const key of KEYS) total[key] += item.nutrients[key] ?? 0;
  }
  const byDateVitD = new Map<string, Nutrients>();
  for (const [date, total] of byDate) {
    const sun = options.includeSun ? sunVitDForDate(input.sunExposures, date) : 0;
    byDateVitD.set(date, sun ? { ...total, vitD: total.vitD + sun } : total);
  }
  for (const [date, muted] of Object.entries(input.mutedDays)) if (muted === false && !byDate.has(date)) {
    byDateVitD.set(date, { ...EMPTY_NUTRIENTS, vitD: options.includeSun ? sunVitDForDate(input.sunExposures, date) : 0 });
  }
  const windowDates = datesInRange(options.range).filter((d) => options.includeToday || d !== todayStr());
  const recorded = windowDates.filter((d) => isDayCounted(input.mutedDays, byDate.has(d), d));
  let averages = { ...EMPTY_NUTRIENTS };
  if (recorded.length) {
    if (options.decayOn) averages = decayWeightedTotals(weighDates(recorded, byDateVitD, options.halfLife));
    else {
      for (const date of recorded) for (const key of KEYS) averages[key] += byDateVitD.get(date)![key];
      for (const key of KEYS) averages[key] /= recorded.length;
    }
  }
  const vitDByDate = new Map<string, number>();
  for (const [d, t] of byDate) if (isDayCounted(input.mutedDays, true, d)) vitDByDate.set(d, t.vitD);
  if (options.includeSun) for (const d of new Set(input.sunExposures.map((e) => e.date))) vitDByDate.set(d, (vitDByDate.get(d) ?? 0) + sunVitDForDate(input.sunExposures, d));
  const anchor = options.includeToday ? todayStr() : todayStr(new Date(Date.now() - 86_400_000));
  return { byDate, byDateVitD, windowDates, recorded, averages, vitDStatus: vitaminDFlux(vitDByDate, anchor) };
}
