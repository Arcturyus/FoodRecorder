import { describe, expect, it, vi, afterEach } from 'vitest';
import { extractSun, parseSunRules } from '../src/extraction/sun';

/** Réponse simulée du pont Claude Code (mode « claudecode » = un simple fetch). */
function mockBridge(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: JSON.stringify(payload) }),
    })),
  );
}

const NOW = new Date('2026-07-17T12:00:00');

afterEach(() => vi.unstubAllGlobals());

describe('extractSun — plusieurs sorties en une dictée', () => {
  it('renvoie une sortie par exposition décrite', async () => {
    mockBridge({
      sorties: [
        { heure: '08:00', dureeMin: 20, peau: 'visage-bras' },
        { heure: '17:00', dureeMin: 30, peau: 'bras-jambes' },
      ],
    });
    const { sorties, source } = await extractSun(
      'je suis sorti vingt minutes ce matin en t-shirt et une demi-heure à 17h en short',
      'claudecode',
      '',
      '',
    );
    expect(source).toBe('claudecode');
    expect(sorties).toHaveLength(2);
    expect(sorties[0]).toMatchObject({ heure: '08:00', dureeMin: 20, peau: 'visage-bras' });
    expect(sorties[1]).toMatchObject({ heure: '17:00', dureeMin: 30, peau: 'bras-jambes' });
  });

  it('n’applique pas l’heure/durée du parseur à règles quand il y a plusieurs sorties', async () => {
    // Le parseur à règles ne voit qu'une heure (« ce matin » → 08:00) et une
    // durée : les propager écraserait la 2e sortie.
    mockBridge({
      sorties: [
        { heure: '08:00', dureeMin: 20 },
        { heure: '17:00', dureeMin: 30 },
      ],
    });
    const { sorties } = await extractSun('vingt minutes ce matin puis une demi-heure à 17h', 'claudecode', '', '');
    expect(sorties[1].heure).toBe('17:00');
    expect(sorties[1].dureeMin).toBe(30);
  });

  it('complète une sortie unique avec ce que le LLM a oublié (date des règles)', async () => {
    // Le LLM ne renvoie que la durée ; « hier » n'est vu que par les règles.
    mockBridge({ sorties: [{ dureeMin: 25 }] });
    const { sorties } = await extractSun('hier je suis sorti vingt-cinq minutes', 'claudecode', '', '');
    expect(sorties).toHaveLength(1);
    expect(sorties[0].dureeMin).toBe(25);
    expect(sorties[0].date).toBe(parseSunRules('hier je suis sorti vingt-cinq minutes').date);
    expect(sorties[0].date).toBeTruthy();
  });

  it('tolère un objet de sortie nu (sans l’enveloppe « sorties »)', async () => {
    mockBridge({ heure: '13:00', dureeMin: 30, ciel: 'tres-ensoleille' });
    const { sorties } = await extractSun('une demi-heure au soleil ce midi', 'claudecode', '', '');
    expect(sorties).toHaveLength(1);
    expect(sorties[0]).toMatchObject({ heure: '13:00', dureeMin: 30, ciel: 'tres-ensoleille' });
  });

  it('tolère un tableau nu', async () => {
    mockBridge([{ heure: '13:00', dureeMin: 30 }, { heure: '18:00', dureeMin: 15 }]);
    const { sorties } = await extractSun('deux sorties', 'claudecode', '', '');
    expect(sorties).toHaveLength(2);
  });

  it('ignore une date future renvoyée par le LLM', async () => {
    mockBridge({ sorties: [{ date: '2099-01-01', dureeMin: 30 }] });
    const { sorties } = await extractSun('trente minutes au soleil', 'claudecode', '', '');
    expect(sorties[0].date).toBeUndefined();
  });

  it('replie sur le parseur à règles si le LLM ne renvoie rien d’exploitable', async () => {
    mockBridge({ sorties: [] });
    const { sorties, source } = await extractSun('une demi-heure au soleil ce midi', 'claudecode', '', '');
    expect(source).toBe('rules');
    expect(sorties).toHaveLength(1);
    expect(sorties[0].dureeMin).toBe(30);
  });

  it('mode règles : une seule sortie, sans appel réseau', async () => {
    const { sorties, source } = await extractSun(
      'ce midi je suis resté une demi-heure en plein soleil en short',
      'rules',
      '',
      '',
      );
    expect(source).toBe('rules');
    expect(sorties).toHaveLength(1);
    expect(sorties[0]).toMatchObject({ heure: '13:00', dureeMin: 30, ciel: 'tres-ensoleille', peau: 'bras-jambes' });
  });

  it('dictée vide ou incomprise → aucune sortie (rien n’est enregistré)', async () => {
    expect((await extractSun('   ', 'rules', '', '')).sorties).toEqual([]);
    expect((await extractSun('bonjour', 'rules', '', '')).sorties).toEqual([]);
  });
});

describe('parseSunRules — repère de non-régression', () => {
  it('lit heure, durée, ciel, peau et crème', () => {
    const p = parseSunRules('ce midi je suis resté une demi-heure en plein soleil en short avec de la crème solaire', NOW);
    expect(p).toMatchObject({
      heure: '13:00',
      dureeMin: 30,
      ciel: 'tres-ensoleille',
      peau: 'bras-jambes',
      creme: 'complete',
    });
  });

  it('comprend les durées dictées en toutes lettres', () => {
    // À la voix on dit « vingt minutes », pas « 20 minutes » ; sans ça, la durée
    // du curseur serait enregistrée telle quelle par l'auto-validation.
    expect(parseSunRules('vingt minutes ce matin en t-shirt', NOW).dureeMin).toBe(20);
    expect(parseSunRules('dix-sept minutes au soleil', NOW).dureeMin).toBe(17);
    expect(parseSunRules('un quart d’heure dehors', NOW).dureeMin).toBe(15);
    // Apostrophe typographique (ce que produit la dictée) comme droite.
    expect(parseSunRules("trois quarts d'heure au soleil", NOW).dureeMin).toBe(45);
    expect(parseSunRules('trois quarts d’heure au soleil', NOW).dureeMin).toBe(45);
    expect(parseSunRules('sorti en fin d’après-midi', NOW).heure).toBe('17:00');
    expect(parseSunRules('deux heures au soleil', NOW).dureeMin).toBe(120);
    // Les chiffres restent prioritaires et inchangés.
    expect(parseSunRules('45 minutes au soleil', NOW).dureeMin).toBe(45);
    expect(parseSunRules('1h30 au soleil', NOW).dureeMin).toBe(90);
  });
});
