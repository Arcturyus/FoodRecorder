import { afterEach, describe, expect, it } from 'vitest';
import { mergeCalorieGoals, normalizeCalorieGoals, recordCalorieGoal, resolveCalorieGoal, type DailyCalorieGoals } from '../src/nutrition/calorieGoals';
import { useStore } from '../src/store/store';
import { buildBackup, importBackup } from '../src/store/backup';
const initial = useStore.getState();
afterEach(() => useStore.setState(initial));
const recorded = (kcal: number, updatedAt = 1) => ({ kcal, updatedAt, source: 'recorded' as const });

describe('daily calorie goals', () => {
  it('updates today, freezes previous days and carries the old setting across closed days', () => {
    let goals: DailyCalorieGoals = {};
    goals = recordCalorieGoal(goals, '2026-10-01', 2000, 1);
    goals = recordCalorieGoal(goals, '2026-10-01', 2100, 2);
    goals = recordCalorieGoal(goals, '2026-10-04', 2400, 3);
    expect(goals['2026-10-01'].kcal).toBe(2100);
    expect(goals['2026-10-02']).toMatchObject({ kcal: 2100, source: 'carried' });
    expect(goals['2026-10-03'].kcal).toBe(2100);
    expect(goals['2026-10-04'].kcal).toBe(2400);
    expect(recordCalorieGoal(goals, '2026-10-04', 2400, 99)).toBe(goals);
  });
  it('approximates only old unknown goals by Monday-Sunday intake, excluding blanks, mutes and today', () => {
    const calories = new Map([['2026-10-05', 1800], ['2026-10-06', 2200], ['2026-10-07', 500], ['2026-10-12', 3000], ['2026-10-13', 9000]]);
    expect(resolveCalorieGoal('2026-10-05', {}, calories, { '2026-10-07': true }, 2500, '2026-10-13')).toEqual({ kcal: 2000, source: 'weekly-estimate' });
    expect(resolveCalorieGoal('2026-10-12', {}, calories, {}, 2500, '2026-10-13')!.kcal).toBe(3000);
    expect(resolveCalorieGoal('2026-10-05', {}, calories, { '2026-10-07': true, '2026-10-08': false }, 2500, '2026-10-13')!.kcal).toBeCloseTo(4000 / 3);
    expect(resolveCalorieGoal('2026-09-01', {}, calories, {}, 2500, '2026-10-13')).toBeNull();
  });
  it('prefers a recorded goal to a weekly approximation and carries settings after recording starts', () => {
    const goals = { '2026-10-05': recorded(2100) }, calories = new Map([['2026-10-05', 1800]]);
    expect(resolveCalorieGoal('2026-10-05', goals, calories, {}, 2400, '2026-10-13')!.kcal).toBe(2100);
    expect(resolveCalorieGoal('2026-10-06', goals, calories, {}, 2400, '2026-10-13')).toMatchObject({ kcal: 2100, source: 'carried' });
    expect(resolveCalorieGoal('2026-10-13', goals, calories, {}, 2400, '2026-10-13')).toEqual({ kcal: 2400, source: 'current' });
  });
  it('merges dates and preserves observed daily settings over inferred carried settings', () => {
    const a = { '2026-10-01': recorded(2000, 10) };
    expect(mergeCalorieGoals(a, { '2026-10-02': recorded(2200), '2026-10-01': { kcal: 1900, source: 'carried', updatedAt: 99 } })).toEqual({ ...a, '2026-10-02': recorded(2200) });
    expect(normalizeCalorieGoals({ '2026-02-30': recorded(2200), '2026-01-01': recorded(NaN), '2026-01-02': recorded(2000) })).toEqual({ '2026-01-02': recorded(2000) });
  });
  it('round-trips daily goals through backup and clears them when restoring a legacy backup', () => {
    useStore.setState({ entries: [], customFoods: [], weightEntries: [], dailyCalorieGoals: { '2026-10-01': recorded(2200) } });
    const backup = buildBackup();
    useStore.setState({ dailyCalorieGoals: {} });
    importBackup(JSON.stringify(backup));
    expect(useStore.getState().dailyCalorieGoals).toEqual(backup.dailyCalorieGoals);
    delete backup.dailyCalorieGoals;
    importBackup(JSON.stringify(backup));
    expect(useStore.getState().dailyCalorieGoals).toEqual({});
  });
});
