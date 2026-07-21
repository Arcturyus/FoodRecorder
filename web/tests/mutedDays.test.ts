import { describe, expect, it, beforeEach } from 'vitest';
import { useStore, isDayCounted } from '../src/store/store';
import type { JournalEntry } from '../src/store/store';

const D = '2026-07-19';
const entry = (date: string): JournalEntry => ({
  id: `e-${date}`,
  date,
  createdAt: 1,
  transcript: '',
  source: 'manuel',
  items: [],
});

beforeEach(() => {
  useStore.setState({ entries: [], mutedDays: {} });
});

describe('isDayCounted (règle pure)', () => {
  it('jour rempli compté par défaut, jour vide non compté', () => {
    expect(isDayCounted({}, true, D)).toBe(true);
    expect(isDayCounted({}, false, D)).toBe(false);
  });

  it('override explicite : true = muté (exclu), false = jeûne (compté)', () => {
    expect(isDayCounted({ [D]: true }, true, D)).toBe(false); // rempli mais muté
    expect(isDayCounted({ [D]: false }, false, D)).toBe(true); // vide mais jeûne
  });
});

describe('setDayMute / toggleDayMute', () => {
  it('mute un jour rempli, puis le recompte (override effacé)', () => {
    useStore.setState({ entries: [entry(D)] });

    useStore.getState().toggleDayMute(D); // compté → muté
    expect(useStore.getState().mutedDays[D]).toBe(true);
    expect(isDayCounted(useStore.getState().mutedDays, true, D)).toBe(false);

    useStore.getState().toggleDayMute(D); // muté → recompté, revient au défaut
    expect(useStore.getState().mutedDays[D]).toBeUndefined();
    expect(isDayCounted(useStore.getState().mutedDays, true, D)).toBe(true);
  });

  it("marque un jour vide comme jeûne, puis annule (override effacé)", () => {
    useStore.getState().toggleDayMute(D); // vide non compté → jeûne compté
    expect(useStore.getState().mutedDays[D]).toBe(false);
    expect(isDayCounted(useStore.getState().mutedDays, false, D)).toBe(true);

    useStore.getState().toggleDayMute(D); // jeûne → défaut (non compté)
    expect(useStore.getState().mutedDays[D]).toBeUndefined();
    expect(isDayCounted(useStore.getState().mutedDays, false, D)).toBe(false);
  });

  it('un jour rempli muté est exclu du filtre des moyennes, un jeûne y entre', () => {
    // Simule le filtre `recorded` de Stats sur une petite fenêtre.
    const filled = '2026-07-18';
    const fast = '2026-07-17';
    const emptyNormal = '2026-07-16';
    useStore.setState({ entries: [entry(filled)], mutedDays: { [filled]: true, [fast]: false } });
    const { mutedDays } = useStore.getState();
    const has = (d: string) => useStore.getState().entries.some((e) => e.date === d);

    const window = [filled, fast, emptyNormal];
    const counted = window.filter((d) => isDayCounted(mutedDays, has(d), d));
    expect(counted).toEqual([fast]); // rempli muté exclu, jeûne inclus, vide normal exclu
  });
});
