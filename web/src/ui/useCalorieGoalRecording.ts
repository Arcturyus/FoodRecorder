import { useEffect, useState } from 'react';
import { todayStr, useStore } from '../store/store';
import { useTargets } from './useTargets';

/** Records effective calories after personal overrides, including across midnight. */
export function useCalorieGoalRecording() {
  const kcal = useTargets().find(t => t.key === 'kcal')!.optimal;
  const record = useStore(s => s.recordCurrentCalorieGoal);
  const history = useStore(s => s.dailyCalorieGoals);
  const [date, setDate] = useState(todayStr);
  useEffect(() => {
    const check = () => setDate(todayStr());
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  // Read the clock at write time: a setting changed just after midnight must
  // not overwrite yesterday while the 30-second date check is still pending.
  useEffect(() => { record(todayStr(), kcal); }, [date, kcal, record, history]);
}
