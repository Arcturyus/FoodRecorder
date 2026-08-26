/**
 * Libellé de source dans l'historique.
 *
 * L'enjeu n'est pas le cas nominal mais le REPLI : une entrée peut arriver par
 * la synchro depuis un appareil plus à jour, avec une source que cette version
 * ne connaît pas. Elle doit s'afficher « IA » — surtout pas « manuel », qui
 * ferait croire à une saisie à la main.
 */

import { describe, expect, it } from 'vitest';
import { sourceLabel, CLOUD_PROVIDERS } from '../src/extraction/providers';

describe('sourceLabel', () => {
  it('nomme les moteurs locaux et les deux ponts', () => {
    expect(sourceLabel('manuel')).toBe('manuel');
    expect(sourceLabel('rules')).toBe('auto');
    expect(sourceLabel('llm')).toBe('IA locale');
    expect(sourceLabel('claudecode')).toBe('Claude Code');
    expect(sourceLabel('codex')).toBe('Codex');
  });

  it('nomme chaque fournisseur de clé API', () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(sourceLabel(p), `source « ${p} »`).not.toBe('IA');
    }
    expect(sourceLabel('anthropic')).toBe('Claude (Anthropic)');
    expect(sourceLabel('gemini')).toBe('Gemini (Google)');
  });

  it('une source inconnue s’affiche « IA », jamais « manuel »', () => {
    // Cas réel : un appareil pas encore à jour reçoit par la synchro une entrée
    // produite par un fournisseur ajouté après lui.
    for (const inconnu of ['fournisseur-du-futur', '', 'CLAUDECODE']) {
      expect(sourceLabel(inconnu)).toBe('IA');
    }
  });
});
