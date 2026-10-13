/** Adapted from SimuComposition/src/maintenance/model.ts (maintenance-calendar-hac-v1).
 * Cumulative intake regression, with covariance weighted by real calendar distance.
 * No CSV or personal example data is embedded in FoodRecorder.
 */
import type { JournalEntry } from '../store/store';
import type { WeightEntry } from '../weight/types';

export type Day = { date: string; day: number; weight: number | null; intake: number | null; protocol: string; standard: boolean };
export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
export const MAINTENANCE_MODEL_VERSION = 'maintenance-calendar-hac-v1';

/** One latest eligible weight per day; muted and absent food days stay unknown. */
export function maintenanceDays(entries: JournalEntry[], weights: WeightEntry[], mutedDays: Record<string, boolean>, standardOnly: boolean, today: string): Day[] {
  const calories = new Map<string, number>();
  for (const e of entries) {
    if (e.date > today) continue;
    calories.set(e.date, (calories.get(e.date) ?? 0) + e.items.reduce((sum, it) => sum + it.nutrients.kcal, 0));
  }
  const dailyWeights = new Map<string, WeightEntry>();
  for (const w of [...weights].sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`))) {
    if (w.date <= today && Number.isFinite(w.poids) && w.poids > 0 && (!standardOnly || (w.aJeun && w.nu))) dailyWeights.set(w.date, w);
  }
  const dates = [...new Set([...calories.keys(), ...dailyWeights.keys(), ...Object.keys(mutedDays).filter(d => d <= today)])].sort();
  if (!dates.length) return [];
  const out: Day[] = [];
  for (let day = dayNumber(dates[0]); day <= dayNumber(dates[dates.length - 1]); day++) {
    const date = new Date(day * 86400000).toISOString().slice(0, 10);
    const w = dailyWeights.get(date);
    const intake = mutedDays[date] === true ? null : calories.get(date) ?? (mutedDays[date] === false ? 0 : null);
    out.push({ date, day, weight: w?.poids ?? null, intake, standard: !!w?.aJeun && !!w?.nu, protocol: w ? `${w.heure} · à jeun : ${w.aJeun ? 'oui' : 'non'} · nu : ${w.nu ? 'oui' : 'non'}` : '' });
  }
  return out;
}

/** Longest complete interval with at least four eligible weight observations.
 * The last morning weight needs no intake on that final date.
 */
export function defaultPeriod(rows: Day[], standardOnly = true): { start: string; end: string } {
  let first: Day | null = null, count = 0, previous: Day | null = null;
  let best: { start: string; end: string; duration: number } | null = null;
  for (const row of rows) {
    if (previous && (previous.intake === null || row.day !== previous.day + 1)) { first = null; count = 0; }
    if (row.weight !== null && (!standardOnly || row.standard)) {
      first ??= row;
      count++;
      const duration = row.day - first.day;
      if (count >= 4 && (!best || duration >= best.duration)) best = { start: first.date, end: row.date, duration };
    }
    previous = row;
  }
  return { start: best?.start ?? rows[0]?.date ?? '', end: best?.end ?? rows[rows.length - 1]?.date ?? '' };
}

export type Options = { start: string; end: string; standardOnly: boolean; rho: number; lag: number; confidence: 90 | 95 | 99; intakeBias: number }
export function estimate(rows: Day[], options: Options) {
  const { rho, lag, confidence, intakeBias } = options
  if (!(rho > 0) || !Number.isFinite(rho) || !Number.isFinite(intakeBias) || lag < 0 || !Number.isFinite(lag) || ![90, 95, 99].includes(confidence)) throw new Error('Paramètres numériques invalides.')
  if (!options.start || !options.end || options.start > options.end) throw new Error('Choisissez une période valide.')
  const selected = rows.filter(r => r.date >= options.start && r.date <= options.end)
  const weights = selected.filter(r => r.weight !== null && (!options.standardOnly || r.standard))
  if (weights.length < 4) throw new Error('Il faut au moins 4 pesées retenues pour cet ajustement et son incertitude.')
  const first = weights[0], last = weights[weights.length - 1], duration = last.day - first.day
  if (duration <= 0) throw new Error('Les pesées doivent couvrir plusieurs jours.')
  const byDay = new Map(rows.map(r => [r.day, r])); let cumulative = 0
  const totals = new Map<number, number>()
  for (let d = first.day; d <= last.day; d++) {
    totals.set(d, cumulative)
    if (d < last.day) {
      const row = byDay.get(d)
      if (!row || row.intake === null || !Number.isFinite(row.intake)) throw new Error(`Calories manquantes le ${new Date(d * 86400000).toISOString().slice(0, 10)} : impossible de cumuler sans inventer une valeur.`)
      cumulative += row.intake + intakeBias
    }
  }
  const points = weights.map(r => ({ ...r, t: r.day - first.day, cumulative: totals.get(r.day)!, y: r.weight! - totals.get(r.day)! / rho }))
  const n = points.length, meanT = points.reduce((s, p) => s + p.t, 0) / n, meanY = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.t - meanT) ** 2, 0)
  const sxy = points.reduce((s, p) => s + (p.t - meanT) * (p.y - meanY), 0)
  const slope = sxy / sxx, intercept = meanY - slope * meanT, maintenance = -rho * slope
  const fitted = points.map(p => ({ ...p, fitted: intercept + slope * p.t + p.cumulative / rho, residual: p.y - intercept - slope * p.t, centeredT: p.t - meanT }))
  const sse = fitted.reduce((s, p) => s + p.residual ** 2, 0)
  // Bartlett kernel on calendar-day distances; no fabricated daily weight observations.
  let meat = 0
  for (const a of fitted) for (const b of fitted) {
    const distance = Math.abs(a.day - b.day)
    const kernel = Math.max(0, 1 - distance / (lag + 1))
    meat += kernel * a.centeredT * a.residual * b.centeredT * b.residual
  }
  const variance = n / (n - 2) * meat / sxx ** 2
  const se = rho * Math.sqrt(Math.max(0, variance)), iidSe = rho * Math.sqrt(sse / (n - 2) / sxx)
  const z = { 90: 1.644853627, 95: 1.959963985, 99: 2.575829304 }[confidence]
  const margin = z * se
  const naive = cumulative / duration - rho * (last.weight! - first.weight!) / duration
  return { points: fitted, n, duration, first: first.date, last: last.date, meanT, meanY, sxx, sxy, slope, intercept, maintenance, se, iidSe, z, margin, low: maintenance - margin, high: maintenance + margin, residualSd: Math.sqrt(sse / (n - 2)), sse, meat, variance, cumulative, meanIntake: cumulative / duration, naive, excluded: selected.filter(r => r.weight !== null).length - n }
}
