import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTool } from '../src/agent/tools';
import { executeAction, readAgentActivity, recordRefusal, undoActivity } from '../src/agent/actions';
import { useStore } from '../src/store/store';
import { useNavigation } from '../src/agent/navigation';
import { ACTION_TOOLS } from '../src/agent/actions';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { JournalEntry } from '../src/store/store';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

vi.stubGlobal('localStorage', new MemoryStorage());

async function prepare(name: string, args: unknown) {
  const tool = findTool(name)!;
  const parsed = tool.schema.safeParse(args);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !tool.prepare) throw new Error('Plan impossible');
  return tool.prepare(parsed.data);
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ entries: [], weightEntries: [], sunExposures: [], dayNotes: {}, nutrientTargets: {} });
  useNavigation.setState({ tab: 'jour', dayDate: '2026-08-31', section: undefined, nonce: 0 });
});

describe('écritures confirmées de l’agent', () => {
  it('classe toute action de données comme écriture à confirmer', () => {
    const dataActions = ACTION_TOOLS.filter((tool) => tool.name !== 'naviguer');
    expect(dataActions.length).toBeGreaterThan(0);
    expect(dataActions.every((tool) => tool.policy === 'confirm' && !!tool.prepare)).toBe(true);
  });
  it('prépare un repas sans écrire puis l’exécute seulement après confirmation', async () => {
    const p = await prepare('ajouter_repas', { date: '2026-08-31', aliments: [{ aliment: 'pomme', quantite: 100, unite: 'g' }] });
    expect(useStore.getState().entries).toHaveLength(0);
    const done = await executeAction(p);
    expect(useStore.getState().entries).toHaveLength(1);
    expect(done.activity.createdIds).toHaveLength(1);
    expect(readAgentActivity()[0]).toMatchObject({ tool: 'ajouter_repas', status: 'confirmed', undoable: true });
  });

  it('refuse sans mutation et conserve le refus dans l’activité', async () => {
    const p = await prepare('noter_jour', { date: '2026-08-31', note: 'Repos' });
    recordRefusal(p);
    expect(useStore.getState().dayNotes).toEqual({});
    expect(readAgentActivity()[0]).toMatchObject({ status: 'refused' });
  });

  it('bloque la confirmation quand la précondition a changé', async () => {
    const p = await prepare('noter_jour', { date: '2026-08-31', note: 'Repos' });
    useStore.getState().setDayNote('2026-08-31', 'Modifiée ailleurs');
    await expect(executeAction(p)).rejects.toThrow('changé');
    expect(useStore.getState().dayNotes['2026-08-31']).toBe('Modifiée ailleurs');
    expect(readAgentActivity()[0].status).toBe('conflict');
  });

  it('annule une création intacte mais refuse un inverse après modification concurrente', async () => {
    const first = await prepare('ajouter_pesee', { date: '2026-08-31', heure: '08:00', poids: 70 });
    const done = await executeAction(first);
    expect(undoActivity(done.activity.id).ok).toBe(true);
    expect(useStore.getState().weightEntries).toHaveLength(0);

    const second = await prepare('ajouter_pesee', { date: '2026-08-31', heure: '09:00', poids: 71 });
    const changed = await executeAction(second);
    useStore.getState().updateWeightEntry(changed.activity.createdIds![0], { poids: 72 });
    const undo = undoActivity(changed.activity.id);
    expect(undo.ok).toBe(false);
    expect(undo.message).toContain('Conflit');
    expect(useStore.getState().weightEntries[0].poids).toBe(72);
  });

  it('annonce le rayon d’impact d’une mutation globale', async () => {
    const p = await prepare('modifier_profil', { objectif: 'muscle', surplusPct: 8 });
    expect(p.preview).toContain('objectif=muscle');
    expect(p.impact).toContain('Recalcul global');
  });

  it('affiche un avant/après nutritionnel et conserve les nutriments non fournis', async () => {
    useStore.setState({ customFoods: [{
      id: 'raisin', nom: 'Raisin', aliases: [], categorie: 'autre', origine: 'catalogue', aVerifier: true,
      n: { ...EMPTY_NUTRIENTS, vitC: 3, vitB9: 2, potassium: 191 },
    }] });
    const p = await prepare('modifier_aliment_global', { id: 'raisin', categorie: 'fruit', nutriments: { vitC: 4 } });
    expect(p.changes?.[0]).toMatchObject({ label: 'Raisin', fields: [
      expect.objectContaining({ key: 'categorie', before: 'autre', after: 'fruit' }),
      expect.objectContaining({ key: 'vitC', before: 3, after: 4, unit: 'mg/100 g' }),
    ] });
    await executeAction(p);
    expect(useStore.getState().customFoods[0]).toMatchObject({ categorie: 'fruit', n: expect.objectContaining({ vitC: 4, vitB9: 2, potassium: 191 }) });
    expect(useStore.getState().customFoods[0].aVerifier).toBe(true);
  });

  it('reclasse plusieurs aliments atomiquement avec une confirmation et une annulation', async () => {
    useStore.setState({ customFoods: [
      { id: 'raisin', nom: 'Raisin', aliases: [], categorie: 'autre', n: { ...EMPTY_NUTRIENTS, vitC: 3 }, origine: 'catalogue', aVerifier: true },
      { id: 'pomme', nom: 'Pomme', aliases: [], categorie: 'autre', n: { ...EMPTY_NUTRIENTS, vitC: 4.6 }, origine: 'catalogue', aVerifier: true },
    ] });
    const p = await prepare('modifier_aliments_banque', { modifications: [
      { id: 'raisin', categorie: 'fruit', nutriments: { vitC: 4 } },
      { id: 'pomme', categorie: 'fruit' },
    ] });
    expect(p.changes).toHaveLength(2);
    const done = await executeAction(p);
    expect(useStore.getState().customFoods.map((food) => food.categorie)).toEqual(['fruit', 'fruit']);
    expect(useStore.getState().customFoods[1].aVerifier).toBe(true);
    expect(undoActivity(done.activity.id).ok).toBe(true);
    expect(useStore.getState().customFoods.map((food) => food.categorie)).toEqual(['autre', 'autre']);
    expect(useStore.getState().customFoods[0].n.vitC).toBe(3);
  });

  it('retire des alias puis crée et annule des fiches distinctes', async () => {
    useStore.setState({ customFoods: [{
      id: 'salade', nom: 'Salade verte', aliases: ['Laitue', 'Batavia', 'Mâche', 'Roquette'], categorie: 'legume',
      n: { ...EMPTY_NUTRIENTS, vitC: 12 }, origine: 'catalogue',
    }] });
    const correction = await executeAction(await prepare('modifier_aliments_banque', {
      modifications: [{ id: 'salade', nom: 'Laitue, crue', aliases: ['Laitue', 'Salade verte'] }],
    }));
    expect(correction.activity.undoable).toBe(true);
    expect(useStore.getState().customFoods[0].aliases).toEqual(['Laitue', 'Salade verte']);

    const invalid = findTool('creer_aliment_banque')!.schema.safeParse({ nom: 'Batavia, crue', categorie: 'legume', nutriments: { vitC: 4.4 } });
    expect(invalid.success).toBe(false);

    const created = await executeAction(await prepare('creer_aliment_banque', {
      nom: 'Batavia, crue', aliases: ['Batavia'], categorie: 'legume',
      nutriments: { ...EMPTY_NUTRIENTS, proteines: 1.2, fibres: 1, calcium: 26, magnesium: 8.7, potassium: 200, fer: 0.39, vitC: 4.4, vitB9: 65.6, vitK1: 20.6 },
    }));
    expect(created.activity.createdIds).toHaveLength(1);
    expect((created.content as { food: { aVerifier?: boolean; origine?: string } }).food).toMatchObject({ origine: 'ia', aVerifier: true });
    expect(useStore.getState().customFoods.map((food) => food.nom)).toContain('Batavia, crue');
    expect(undoActivity(created.activity.id).ok).toBe(true);
    expect(useStore.getState().customFoods.map((food) => food.nom)).not.toContain('Batavia, crue');
  });

  it('refuse tout le lot si un aliment a changé après l’aperçu', async () => {
    useStore.setState({ customFoods: [
      { id: 'raisin', nom: 'Raisin', aliases: [], categorie: 'autre', n: { ...EMPTY_NUTRIENTS }, origine: 'catalogue' },
      { id: 'pomme', nom: 'Pomme', aliases: [], categorie: 'autre', n: { ...EMPTY_NUTRIENTS }, origine: 'catalogue' },
    ] });
    const p = await prepare('modifier_aliments_banque', { modifications: [{ id: 'raisin', categorie: 'fruit' }, { id: 'pomme', categorie: 'fruit' }] });
    useStore.getState().editFood('pomme', { nom: 'Pomme modifiée ailleurs' });
    await expect(executeAction(p)).rejects.toThrow('changé');
    expect(useStore.getState().customFoods.find((food) => food.id === 'raisin')?.categorie).toBe('autre');
  });

  it('corrige puis annule un repas existant', async () => {
    const meal: JournalEntry = { id: 'meal-1', date: '2026-08-30', createdAt: 1, transcript: '', source: 'manuel', items: [{ id: 'item-1', foodId: null, nomAffiche: 'Pomme', quantite: 100, unite: 'g', grams: 100, nutrients: { ...EMPTY_NUTRIENTS, kcal: 52 }, estimation: false, douteux: false }] };
    useStore.setState({ entries: [meal] });
    const plan = await prepare('modifier_repas', { id: 'meal-1', date: '2026-08-31', aliments: [{ id: 'item-1', quantite: 200 }] });
    const done = await executeAction(plan);
    expect(useStore.getState().entries[0]).toMatchObject({ date: '2026-08-31', items: [{ quantite: 200 }] });
    expect(undoActivity(done.activity.id).ok).toBe(true);
    expect(useStore.getState().entries[0]).toEqual(meal);
  });

  it('supprime et restaure une pesée et une exposition solaire', async () => {
    useStore.setState({
      weightEntries: [{ id: 'w-1', date: '2026-08-31', heure: '08:00', poids: 70, aJeun: true, nu: true, source: 'manuel', createdAt: 1 }],
      sunExposures: [{ id: 's-1', date: '2026-08-31', heure: '12:00', dureeMin: 20, ciel: 'ensoleille', peau: 'visage-bras', phenotype: 'blanc', creme: 'aucune', createdAt: 1 }],
    });
    const weight = await executeAction(await prepare('supprimer_pesee', { id: 'w-1' }));
    const sun = await executeAction(await prepare('supprimer_soleil', { id: 's-1' }));
    expect(useStore.getState().weightEntries).toHaveLength(0);
    expect(useStore.getState().sunExposures).toHaveLength(0);
    expect(undoActivity(weight.activity.id).ok).toBe(true);
    expect(undoActivity(sun.activity.id).ok).toBe(true);
    expect(useStore.getState().weightEntries[0].id).toBe('w-1');
    expect(useStore.getState().sunExposures[0].id).toBe('s-1');
  });

  it('corrige puis annule une pesée et une exposition solaire', async () => {
    useStore.setState({
      weightEntries: [{ id: 'w-edit', date: '2026-08-31', heure: '08:00', poids: 70, aJeun: true, nu: true, source: 'manuel', createdAt: 1 }],
      sunExposures: [{ id: 's-edit', date: '2026-08-31', heure: '12:00', dureeMin: 20, ciel: 'ensoleille', peau: 'visage-bras', phenotype: 'blanc', creme: 'aucune', createdAt: 1 }],
    });
    const weight = await executeAction(await prepare('modifier_pesee', { id: 'w-edit', poids: 71 }));
    const sun = await executeAction(await prepare('modifier_soleil', { id: 's-edit', dureeMin: 35 }));
    expect(useStore.getState().weightEntries[0].poids).toBe(71);
    expect(useStore.getState().sunExposures[0].dureeMin).toBe(35);
    expect(undoActivity(weight.activity.id).ok).toBe(true);
    expect(undoActivity(sun.activity.id).ok).toBe(true);
    expect(useStore.getState().weightEntries[0].poids).toBe(70);
    expect(useStore.getState().sunExposures[0].dureeMin).toBe(20);
  });

  it('inclut explicitement un jour vide puis annule le réglage', async () => {
    const done = await executeAction(await prepare('regler_jour_compte', { date: '2026-08-29', compte: true }));
    expect(useStore.getState().mutedDays['2026-08-29']).toBe(false);
    expect(undoActivity(done.activity.id).ok).toBe(true);
    expect(useStore.getState().mutedDays).not.toHaveProperty('2026-08-29');
  });
});

describe('navigation agentique', () => {
  it('ouvre un onglet et une section depuis une liste fermée', async () => {
    const tool = findTool('naviguer')!;
    const parsed = tool.schema.parse({ onglet: 'nutriments', section: 'nutriments-reglages' });
    await tool.run(parsed);
    expect(useNavigation.getState()).toMatchObject({ tab: 'nutriments', section: 'nutriments-reglages', nonce: 1 });
    expect(tool.schema.safeParse({ onglet: 'admin' }).success).toBe(false);
  });
});
