import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../src/store/store';
import { SEED_WEIGHT_ENTRIES } from '../src/weight/seed';

/** Réinitialise le store à ses valeurs de départ entre les tests. */
beforeEach(() => {
  useStore.setState({ weightEntries: [...SEED_WEIGHT_ENTRIES] });
});

describe('store des pesées', () => {
  it('est pré-rempli avec les journées du CSV', () => {
    expect(useStore.getState().weightEntries.length).toBe(SEED_WEIGHT_ENTRIES.length);
  });

  it('addWeightEntry enregistre une pesée et renvoie un id', () => {
    const before = useStore.getState().weightEntries.length;
    const id = useStore.getState().addWeightEntry({
      date: '2026-07-10',
      heure: '08:30',
      aJeun: true,
      nu: true,
      poids: 70.2,
      source: 'manuel',
    });
    const state = useStore.getState();
    expect(state.weightEntries.length).toBe(before + 1);
    const saved = state.weightEntries.find((e) => e.id === id);
    expect(saved?.poids).toBe(70.2);
    expect(saved?.createdAt).toBeGreaterThan(0);
  });

  it('synchronise profile.poids avec la pesée la plus récente', () => {
    useStore.getState().addWeightEntry({
      date: '2026-07-10',
      heure: '08:30',
      aJeun: true,
      nu: true,
      poids: 71.5,
      source: 'manuel',
    });
    expect(useStore.getState().profile.poids).toBe(71.5);
  });

  it('une pesée passée ne remplace pas le profil par une valeur ancienne', () => {
    useStore.getState().addWeightEntry({
      date: '2026-07-10', heure: '08:30', aJeun: true, nu: true, poids: 71.5, source: 'manuel',
    });
    useStore.getState().addWeightEntry({
      date: '2020-01-01', heure: '08:30', aJeun: true, nu: true, poids: 60, source: 'manuel',
    });
    // La plus récente reste celle de 2026 → profil inchangé à 71,5.
    expect(useStore.getState().profile.poids).toBe(71.5);
  });

  it('removeWeightEntry supprime la pesée', () => {
    const id = useStore.getState().addWeightEntry({
      date: '2026-07-10', heure: '08:30', aJeun: true, nu: true, poids: 70, source: 'manuel',
    });
    useStore.getState().removeWeightEntry(id);
    expect(useStore.getState().weightEntries.find((e) => e.id === id)).toBeUndefined();
  });

  it('setWeightConfig modifie les constantes', () => {
    useStore.getState().setWeightConfig({ taille: 1.8 });
    expect(useStore.getState().weightConfig.taille).toBe(1.8);
  });
});
