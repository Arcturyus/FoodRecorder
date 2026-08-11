import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../src/store/store';
import { useSyncStore } from '../src/sync/syncStore';
import { initChangeTracker, withRemoteApply } from '../src/sync/changeTracker';
import { importBackup } from '../src/store/backup';
import { DEFAULT_PROFILE } from '../src/nutrition/targets';
import { DEFAULT_WEIGHT_CONFIG } from '../src/weight/types';
import { FOODS } from '../src/nutrition/foods';
import { adoptFromCatalog } from '../src/nutrition/bank';

/** Ma banque de test : quelques aliments du catalogue, comme après une 1re consommation. */
const bank = (...ids: string[]) => ids.map((id) => adoptFromCatalog(FOODS.find((f) => f.id === id)!));

/**
 * Le tracker marque « dirty » les modifications locales par DIFF d'état, sans
 * instrumenter les actions. On vérifie : créations/suppressions, tombstones,
 * répercussion croisée (poids → profil), silence pendant l'application distante,
 * et capture d'un `importBackup` (setState direct hors action).
 */

initChangeTracker();

/** Reset : on vide le store SANS profil actif (donc sans marquer), puis on joint. */
beforeEach(() => {
  useSyncStore.setState({ profileId: null, profileName: null, pending: {}, pullCursor: null, lastSyncAt: null, lastError: null });
  useStore.setState({
    entries: [],
    customFoods: bank('banane', 'pomme'),
    favoriteMeals: [],
    weightEntries: [],
    sunExposures: [],
    profile: DEFAULT_PROFILE,
    weightConfig: DEFAULT_WEIGHT_CONFIG,
  });
  useSyncStore.setState({ profileId: 'p1', profileName: 'p1' });
});

const pending = () => useSyncStore.getState().pending;

describe('changeTracker', () => {
  it('marque une entrée créée, et son tombstone à la suppression', () => {
    const id = useStore.getState().addEntry('une banane', [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }], 'manuel');
    expect(pending()[`journal_entries:${id}`]).toBeTruthy();
    expect(pending()[`journal_entries:${id}`].deleted).toBeFalsy();

    useStore.getState().removeEntry(id);
    expect(pending()[`journal_entries:${id}`].deleted).toBe(true);
  });

  it('marque un ajout manuel (sans dictée ni photo)', () => {
    const banane = FOODS.find((f) => f.id === 'banane')!;
    useStore.getState().addFoodEntry(banane, 100, 'g');
    const id = useStore.getState().entries[0].id;
    expect(pending()[`journal_entries:${id}`]).toBeTruthy();
    expect(pending()[`journal_entries:${id}`].deleted).toBeFalsy();
  });

  it('propage la suppression d’UN item comme mise à jour de l’entrée (pas une suppression du groupe)', () => {
    const id = useStore.getState().addEntry(
      'salade',
      [
        { aliment: 'banane', quantite: 1, unite: 'piece', estimation: false },
        { aliment: 'pomme', quantite: 1, unite: 'piece', estimation: false },
      ],
      'manuel',
    );
    const itemId = useStore.getState().entries.find((e) => e.id === id)!.items[0].id;
    useSyncStore.setState({ pending: {} }); // isoler l'effet de removeItem

    useStore.getState().removeItem(id, itemId);
    const change = pending()[`journal_entries:${id}`];
    expect(change).toBeTruthy();
    expect(change.deleted).toBeFalsy(); // l'entrée existe toujours (1 item restant) → MAJ, pas tombstone
  });

  it('marque l’aliment et les entrées recalculées lors d’une édition d’aliment', () => {
    const id = useStore.getState().addEntry('une banane', [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }], 'manuel');
    useSyncStore.setState({ pending: {} }); // isoler l'effet de editFood

    useStore.getState().editFood('banane', { n: { kcal: 200 } });
    // L'aliment de ma banque est modifié en place (il n'y a plus d'override séparé).
    expect(pending()['custom_foods:banane']).toBeTruthy();
    expect(pending()[`journal_entries:${id}`]).toBeTruthy(); // nutriments recalculés → à re-pousser
  });

  it('marque la pesée ET le profil (poids synchronisé)', () => {
    const id = useStore.getState().addWeightEntry({ date: '2026-07-19', heure: '08:00', aJeun: true, nu: false, poids: 88, source: 'manuel' });
    expect(pending()[`weight_entries:${id}`]).toBeTruthy();
    expect(pending()['profile_kv:profile']).toBeTruthy();
  });

  it('ne marque rien pendant l’application d’un état distant', () => {
    withRemoteApply(() => {
      useStore.getState().addEntry('une pomme', [{ aliment: 'pomme', quantite: 1, unite: 'piece', estimation: false }], 'manuel');
    });
    expect(Object.keys(pending())).toHaveLength(0);
  });

  it('ne marque rien tant qu’aucun profil n’est joint', () => {
    useSyncStore.setState({ profileId: null, profileName: null, pending: {} });
    useStore.getState().addEntry('une poire', [{ aliment: 'poire', quantite: 1, unite: 'piece', estimation: false }], 'manuel');
    expect(Object.keys(pending())).toHaveLength(0);
  });

  it('capture un import de sauvegarde (setState direct)', () => {
    const backup = {
      app: 'foodrecorder',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: [{ id: 'imp1', date: '2026-07-19', createdAt: 1, transcript: 'import', source: 'manuel', items: [] }],
      customFoods: [],
      favoriteMeals: [],
      profile: DEFAULT_PROFILE,
      weightEntries: [],
      weightConfig: DEFAULT_WEIGHT_CONFIG,
      sunExposures: [],
    };
    importBackup(JSON.stringify(backup));
    expect(pending()['journal_entries:imp1']).toBeTruthy();
  });
});
