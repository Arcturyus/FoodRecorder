import { describe, expect, it } from 'vitest';
import { dayNumber, defaultPeriod, estimate, maintenanceDays, type Day, type Options } from '../src/nutrition/maintenance';
import { computeEnergyFor, computeTargets, DEFAULT_PROFILE, type ObservedMaintenance } from '../src/nutrition/targets';
import type { JournalEntry } from '../src/store/store';
import type { WeightEntry } from '../src/weight/types';

const options: Options = { start: '2026-01-01', end: '2026-01-31', standardOnly: true, rho: 7700, lag: 7, confidence: 95, intakeBias: 0 };
function fixture(): Day[] {
  let cumulative = 0;
  return Array.from({ length: 31 }, (_, i) => {
    const date = `2026-01-${String(i + 1).padStart(2, '0')}`, intake = 1800 + i * 20;
    const row = { date, day: dayNumber(date), weight: [0, 4, 11, 19, 30].includes(i) ? 65 + (cumulative - 2200 * i) / 7700 : null, intake, standard: true, protocol: '' };
    cumulative += intake;
    return row;
  });
}
describe('observed maintenance integration', () => {
  it('recovers a known expenditure with variable intake and irregular weights', () => {
    const result = estimate(fixture(), options);
    expect(result.maintenance).toBeCloseTo(2200, 7);
    expect(result.intercept).toBeCloseTo(65, 8);
    expect(result.se).toBeLessThan(1e-8);
  });
  it('does not require last-day calories and translates constant intake bias exactly', () => {
    const rows = fixture(); rows[30].intake = null;
    const result = estimate(rows, options);
    expect(estimate(rows, { ...options, intakeBias: 100 }).maintenance - result.maintenance).toBeCloseTo(100);
    expect(defaultPeriod(rows)).toEqual({ start: options.start, end: options.end });
  });
  it('refuses missing food days and fewer than four retained weights', () => {
    const rows = fixture(); rows[8].intake = null;
    expect(() => estimate(rows, options)).toThrow('2026-01-09');
    expect(() => estimate(fixture().slice(0, 12), options)).toThrow('4 pesées');
    expect(() => estimate(fixture(), { ...options, start: '2026-02-01' })).toThrow('période');
  });
  it('uses calendar distances in covariance, with independently recomputed double sum', () => {
    const rows = fixture(); rows[4].weight! += 0.4; rows[19].weight! -= 0.2;
    const r = estimate(rows, options);
    const sum = r.points.reduce((total, a) => total + r.points.reduce((inner, b) => inner + Math.max(0, 1 - Math.abs(a.t - b.t) / 8) * (a.t - r.meanT) * (b.t - r.meanT) * a.residual * b.residual, 0), 0);
    expect(r.se ** 2).toBeCloseTo(7700 ** 2 * 5 / 3 * sum / r.sxx ** 2, 7);
    expect(estimate(rows, { ...options, confidence: 99 }).margin).toBeGreaterThan(r.margin);
  });
  it('adapts the journal without converting absent or muted days into zeros', () => {
    const entry = { date: '2026-01-01', items: [{ nutrients: { kcal: 2000 } }] } as JournalEntry;
    const weight = { id: 'a', date: '2026-01-01', heure: '08:00', poids: 70, aJeun: true, nu: true } as WeightEntry;
    const evening = { ...weight, id: 'b', heure: '20:00', poids: 72, aJeun: false };
    const rows = maintenanceDays([entry], [weight, evening], { '2026-01-03': false }, true, '2026-01-03');
    expect(rows.map(r => r.intake)).toEqual([2000, null, 0]);
    expect(rows[0].weight).toBe(70);
    expect(maintenanceDays([entry], [weight, evening], { '2026-01-01': true }, false, '2026-01-03')[0]).toMatchObject({ weight: 72, intake: null });
  });
  it('applies one shared maintenance to calorie targets and derived limits, with reversible formulas', () => {
    const observed: ObservedMaintenance = { kcal: 2200, low: 2100, high: 2300, calculatedAt: '2026-02-01T12:00:00Z', n: 5, duration: 30, ...options, version: 'test' };
    const profile = { ...DEFAULT_PROFILE, objectif: 'perte' as const, deficitPct: 20, observedMaintenance: observed, maintenanceMode: 'observed' as const };
    expect(computeEnergyFor(profile)).toMatchObject({ tdee: 2200, cible: 1760 });
    const targets = computeTargets(profile);
    expect(targets.find(t => t.key === 'kcal')!.optimal).toBe(1760);
    expect(targets.find(t => t.key === 'lipides')!.lowThreshold).toBe(Math.round(0.2 * 2200 / 9));
    expect(computeEnergyFor({ ...profile, maintenanceMode: 'formula' })).toEqual(computeEnergyFor({ ...profile, observedMaintenance: undefined }));
    expect(computeEnergyFor({ ...profile, observedMaintenance: { ...observed, kcal: NaN } }).tdee).toBeGreaterThan(0);
    expect(computeTargets(profile, undefined, { kcal: { optimal: 1900 } }).find(t => t.key === 'kcal')!.optimal).toBe(1900);
  });
});
