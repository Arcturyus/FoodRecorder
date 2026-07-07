import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedItem } from '../nutrition/types';
import { validateExtraction } from './schema';
import { parseTranscript } from './ruleParser';

/**
 * Extraction via l'API Claude (option « clé API »).
 * Contrairement au reste de l'app, ceci envoie le texte à l'API Anthropic —
 * la clé et le texte quittent l'appareil. Backend optionnel, désactivé par défaut.
 * Fallback sur le parseur à règles si l'appel échoue.
 */

export interface CloudModelOption {
  id: string;
  label: string;
  hint: string;
}

/** Modèles proposés. Opus 4.8 par défaut ; Haiku 4.5 = le moins cher. */
export const CLOUD_MODELS: CloudModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (recommandé)', hint: 'le plus précis' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'bon compromis' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'le plus rapide et le moins cher' },
];

export const DEFAULT_CLOUD_MODEL = CLOUD_MODELS[0].id;

const SYSTEM_PROMPT = `Tu extrais les aliments d'une phrase en français décrivant un repas.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"items":[{"aliment": string, "quantite": number, "unite": string, "estimation": boolean}]}
Aucun texte hors du JSON.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot"].
- "aliment" : le nom de l'aliment en français, sans quantité ni adjectifs superflus.
- Si la quantité n'est pas donnée, choisis une quantité plausible et mets "estimation": true, sinon false.
- N'invente jamais de valeurs nutritionnelles. N'ajoute aucun aliment non mentionné.

Exemple :
Entrée : "un bol de riz avec 150 g de poulet et un yaourt nature"
Sortie : {"items":[{"aliment":"riz","quantite":1,"unite":"bol","estimation":false},{"aliment":"poulet","quantite":150,"unite":"g","estimation":false},{"aliment":"yaourt nature","quantite":1,"unite":"piece","estimation":false}]}`;

/** Extrait le premier objet JSON d'une réponse texte. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractWithAnthropic(
  transcript: string,
  apiKey: string,
  model: string,
): Promise<{ items: ExtractedItem[]; source: 'anthropic' | 'rules' }> {
  if (!apiKey) return { items: parseTranscript(transcript), source: 'rules' };

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const items = validateExtraction(extractJson(text));
    if (items && items.length > 0) return { items, source: 'anthropic' };
  } catch (e) {
    // clé invalide, réseau, quota… → fallback
    throw e instanceof Anthropic.APIError
      ? new Error(`API Claude : ${e.message}`)
      : e;
  }
  return { items: parseTranscript(transcript), source: 'rules' };
}
