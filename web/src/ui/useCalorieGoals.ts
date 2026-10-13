import { useMemo } from 'react';
import { todayStr, useStore } from '../store/store';
import { caloriesByDate, resolveCalorieGoal } from '../nutrition/calorieGoals';

export function useCalorieGoals(currentKcal: number) {
  const history = useStore(s => s.dailyCalorieGoals);
  const entries = useStore(s => s.entries);
  const muted = useStore(s => s.mutedDays);
  return useMemo(() => {
    const calories = caloriesByDate(entries);
    return (date: string) => resolveCalorieGoal(date, history, calories, muted, currentKcal, todayStr());
  }, [history, entries, muted, currentKcal]);
}
