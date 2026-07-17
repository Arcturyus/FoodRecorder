import { describe, expect, it, vi, afterEach } from 'vitest';
import { verifyMatches } from '../src/extraction/verify';
import { computeItems } from '../src/nutrition/compute';
import { FOODS } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { ExtractedItem, Nutrients } from '../src/nutrition/types';

/** Réponse simulée du pont Claude Code + capture du prompt envoyé. */
let lastPrompt = '';
function mockBridge(payload: unknown) {
  lastPrompt = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      lastPrompt = JSON.parse(init.body).prompt as string;
      return { ok: true, json: async () => ({ text: JSON.stringify(payload) }) };
    }),
  );
}

const item = (aliment: string, quantite = 1, unite: ExtractedItem['unite'] = 'portion'): ExtractedItem => ({
  aliment,
  quantite,
  unite,
  estimation: true,
});

/** Nutriments complets, façon estimation IA. */
const tarte: Nutrients = { ...EMPTY_NUTRIENTS, kcal: 260, proteines: 3, glucides: 34, lipides: 12 };

afterEach(() => vi.unstubAllGlobals());

describe('verifyMatches — l’IA forte tranche sur les matchs incertains', () => {
  it('« pas le même aliment » → l’estimation de l’IA remplace la base', async () => {
    mockBridge({ verdicts: [{ i: 0, meme: false, categorie: 'sucre-snack', grammesParPiece: 120, nutriments: tarte }] });

    const items = [item('tarte à la myrtille')];
    const [out] = await verifyMatches(items, FOODS, 'claudecode', '', '');

    expect(out.nutriments?.kcal).toBe(260);
    expect(out.categorie).toBe('sucre-snack');
    expect(out.grammesParPiece).toBe(120);

    // Et le calcul honore bien l'estimation plutôt que l'aliment de la base.
    const [computed] = computeItems([out], FOODS);
    expect(computed.aiEstime).toBe(true);
    expect(computed.grams).toBe(120);
    expect(computed.nutrients!.kcal).toBeCloseTo(312, 0); // 260 × 1,2
  });

  it('« même aliment » → l’item est inchangé, la base garde la main', async () => {
    mockBridge({ verdicts: [{ i: 0, meme: true }] });
    const items = [item('pommes de terre vapeur', 200, 'g')];
    const [out] = await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(out).toEqual(items[0]);
    expect(out.nutriments).toBeUndefined();
  });

  it('ne soumet PAS les matchs quasi exacts (économie d’appel)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // « banane » correspond exactement à l'aliment « Banane ».
    const items = [item('banane', 1, 'piece')];
    const out = await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toEqual(items);
  });

  it('soumet aussi un aliment INTROUVABLE en base (sinon il ne compte pour rien)', async () => {
    // « soupe de potiron » ne matche aucun aliment de la base.
    mockBridge({ verdicts: [{ i: 0, meme: false, categorie: 'plat', grammesParPiece: 300, nutriments: tarte }] });
    const [out] = await verifyMatches([item('soupe de potiron', 1, 'bol')], FOODS, 'claudecode', '', '');
    // La ligne de l'élément (pas l'exemple du prompt système) annonce l'absence de match.
    expect(lastPrompt).toMatch(/\[0\] dit : "soupe de potiron".*la base propose : RIEN/);
    expect(out.nutriments?.kcal).toBe(260);

    // Sans la 2e passe, cet item n'aurait aucune valeur nutritionnelle.
    const [avant] = computeItems([item('soupe de potiron', 1, 'bol')], FOODS);
    expect(avant.nutrients).toBeNull();
    const [apres] = computeItems([out], FOODS);
    expect(apres.nutrients!.kcal).toBeGreaterThan(0);
  });

  it('rattrape les matchs absurdes du moteur de texte (« pastel de nata » → Pastèque)', async () => {
    // Sans 2e passe, la base sert de la pastèque : 30 kcal/100 g au lieu de ~300.
    mockBridge({ verdicts: [{ i: 0, meme: false, categorie: 'sucre-snack', grammesParPiece: 60, nutriments: { ...tarte, kcal: 298 } }] });
    const [out] = await verifyMatches([item('pastel de nata', 1, 'piece')], FOODS, 'claudecode', '', '');
    expect(lastPrompt).toMatch(/\[0\] dit : "pastel de nata".*la base propose : "Pastèque"/);

    const [avant] = computeItems([item('pastel de nata', 1, 'piece')], FOODS);
    expect(avant.match.food?.nom).toBe('Pastèque');
    const [apres] = computeItems([out], FOODS);
    expect(apres.aiEstime).toBe(true);
    expect(apres.nutrients!.kcal).toBeCloseTo(178.8, 0); // 298 × 0,6
  });

  it('ne soumet pas un item déjà estimé par l’IA à l’extraction', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const items: ExtractedItem[] = [{ ...item('pastel de nata'), nutriments: tarte }];
    await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('soumet plusieurs items douteux en UN seul appel', async () => {
    mockBridge({ verdicts: [{ i: 0, meme: true }, { i: 1, meme: true }] });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await verifyMatches([item('tarte à la myrtille'), item('soupe de potiron')], FOODS, 'claudecode', '', '');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastPrompt).toContain('tarte à la myrtille');
    expect(lastPrompt).toContain('soupe de potiron');
  });

  it('les index renvoyés pointent sur les bons items', async () => {
    // Seul l'item 1 est ré-estimé : l'item 0 doit rester intact.
    mockBridge({ verdicts: [{ i: 1, meme: false, categorie: 'plat', nutriments: tarte }] });
    const items = [item('tarte à la myrtille'), item('soupe de potiron')];
    const out = await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(out[0].nutriments).toBeUndefined();
    expect(out[1].nutriments?.kcal).toBe(260);
  });

  it('l’index porte sur la liste d’origine, pas sur la liste soumise', async () => {
    // « banane » (index 0) est un match exact : non soumis. L'item douteux est
    // l'index 1 — c'est ce numéro que l'IA voit et renvoie.
    mockBridge({ verdicts: [{ i: 1, meme: false, categorie: 'plat', nutriments: tarte }] });
    const items = [item('banane', 1, 'piece'), item('tarte à la myrtille')];
    const out = await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(lastPrompt).toContain('[1] dit : "tarte à la myrtille"');
    expect(lastPrompt).not.toContain('[0] dit : "banane"');
    expect(out[0].nutriments).toBeUndefined();
    expect(out[1].nutriments?.kcal).toBe(260);
  });

  it('ignore un index hallucité hors de la liste soumise', async () => {
    mockBridge({ verdicts: [{ i: 99, meme: false, categorie: 'plat', nutriments: tarte }] });
    const items = [item('tarte à la myrtille')];
    const out = await verifyMatches(items, FOODS, 'claudecode', '', '');
    expect(out[0].nutriments).toBeUndefined();
  });

  it('corrige la quantité et garde une fourchette cohérente', async () => {
    mockBridge({
      verdicts: [{ i: 0, meme: false, categorie: 'plat', quantite: 150, quantiteMin: 120, quantiteMax: 200, nutriments: tarte }],
    });
    const [out] = await verifyMatches([item('tarte à la myrtille')], FOODS, 'claudecode', '', '');
    expect(out.quantite).toBe(150);
    expect(out.quantiteMin).toBe(120);
    expect(out.quantiteMax).toBe(200);
  });

  it('rejette une fourchette incohérente (quantité hors bornes)', async () => {
    mockBridge({
      verdicts: [{ i: 0, meme: false, categorie: 'plat', quantite: 500, quantiteMin: 120, quantiteMax: 200, nutriments: tarte }],
    });
    const [out] = await verifyMatches([item('tarte à la myrtille')], FOODS, 'claudecode', '', '');
    expect(out.quantite).toBe(500);
    expect(out.quantiteMin).toBeUndefined();
    expect(out.quantiteMax).toBeUndefined();
  });

  it('IA indisponible ou réponse illisible → items inchangés (comportement actuel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('pont KO'); }));
    const items = [item('tarte à la myrtille')];
    await expect(verifyMatches(items, FOODS, 'claudecode', '', '')).resolves.toEqual(items);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ text: 'je ne sais pas' }) })));
    await expect(verifyMatches(items, FOODS, 'claudecode', '', '')).resolves.toEqual(items);
  });

  it('ne fait rien hors des modes « IA forte »', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const items = [item('tarte à la myrtille')];
    expect(await verifyMatches(items, FOODS, 'rules', '', '')).toEqual(items);
    expect(await verifyMatches(items, FOODS, 'local', '', '')).toEqual(items);
    // Mode API sans clé : pas d'appel.
    expect(await verifyMatches(items, FOODS, 'cloud', '', 'claude-opus-4-8')).toEqual(items);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
