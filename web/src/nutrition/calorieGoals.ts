import type { JournalEntry } from '../store/store';

export interface DailyCalorieGoal {
  kcal: number;
  source: 'recorded' | 'carried';
  updatedAt: number;
}
export type DailyCalorieGoals = Record<string, DailyCalorieGoal>;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export function normalizeCalorieGoals(value: unknown): DailyCalorieGoals {
  const out: DailyCalorieGoals = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [date, item] of Object.entries(value)) {
    if (!validDate(date) || !item || typeof item !== 'object') continue;
    const r = item as DailyCalorieGoal;
    if (Number.isFinite(r.kcal) && r.kcal > 0 && Number.isFinite(r.updatedAt) && ['recorded', 'carried'].includes(r.source)) out[date] = { kcal: r.kcal, source: r.source, updatedAt: r.updatedAt };
  }
  return out;
}

/** Capture today's final setting; closed days never change when today's target changes. */
export function recordCalorieGoal(history: DailyCalorieGoals, date: string, kcal: number, now: number): DailyCalorieGoals {
  if (!validDate(date) || !Number.isFinite(kcal) || kcal <= 0) return history;
  const priorDates = Object.keys(history).filter(d => d < date).sort();
  const last = priorDates[priorDates.length - 1];
  const next = { ...history };
  if (last) {
    for (let t = Date.parse(`${last}T00:00:00Z`) + 86400000; t < Date.parse(`${date}T00:00:00Z`); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10);
      next[d] ??= { ...history[last], source: 'carried' };
    }
  }
  if (history[date]?.kcal !== kcal || history[date]?.source !== 'recorded') next[date] = { kcal, source: 'recorded', updatedAt: now };
  return JSON.stringify(next) === JSON.stringify(history) ? history : next;
}

/** Independent days from two devices survive a whole-map cloud update. */
export function mergeCalorieGoals(local: DailyCalorieGoals, remote: unknown): DailyCalorieGoals {
  const out = { ...local };
  for (const [date, goal] of Object.entries(normalizeCalorieGoals(remote))) {
    const current = out[date];
    if (!current || (current.source === 'carried' && goal.source === 'recorded') ||
      (current.source === goal.source && goal.updatedAt > current.updatedAt)) out[date] = goal;
  }
  return out;
}
export type ResolvedCalorieGoal = { kcal: number; source: DailyCalorieGoal['source'] | 'weekly-estimate' | 'current' };

export function caloriesByDate(entries: JournalEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) out.set(e.date, (out.get(e.date) ?? 0) + e.items.reduce((sum, it) => sum + it.nutrients.kcal, 0));
  return out;
}

/** Historical approximation only precedes the first known goal. Weeks start Monday.
 * Blank/excluded days are absent; explicitly counted fasting days contribute zero.
 */
export function resolveCalorieGoal(date: string, history: DailyCalorieGoals, calories: Map<string, number>, muted: Record<string, boolean>, currentKcal: number, today: string): ResolvedCalorieGoal | null {
  if (date >= today) return currentKcal > 0 ? { kcal: currentKcal, source: 'current' } : null;
  if (history[date]) return history[date];
  const prior = Object.keys(history).filter(d => d < date).sort().pop();
  if (prior) return { kcal: history[prior].kcal, source: 'carried' };
  if (!validDate(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const start = d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000;
  let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const key = new Date(start + i * 86400000).toISOString().slice(0, 10);
    if (key >= today || muted[key] === true) continue;
    const kcal = calories.get(key) ?? (muted[key] === false ? 0 : undefined);
    if (kcal !== undefined && Number.isFinite(kcal)) { sum += kcal; n++; }
  }
  return n > 0 && sum > 0 ? { kcal: sum / n, source: 'weekly-estimate' } : null;
}

export function calorieGoalLabel(goal: ResolvedCalorieGoal | null): string {
  if (!goal) return 'objectif inconnu';
  return goal.source === 'weekly-estimate' ? 'objectif approximé par la moyenne de la semaine' :
    goal.source === 'carried' ? 'objectif reconduit du dernier réglage connu' :
    goal.source === 'recorded' ? 'objectif enregistré ce jour' : 'objectif actuel';
}
