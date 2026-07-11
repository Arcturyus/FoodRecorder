import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedItem } from '../nutrition/types';
import { validateExtraction } from './schema';
import { parseTranscript } from './ruleParser';

/**
 * Extraction via l'API Claude (option « clé API »).
 * Contrairement au reste de l'app, ceci envoie le texte à l'API Anthropic —
 * la clé et le texte quittent l'appareil. Backend optionnel, désactivé par défaut.
 * Fallback sur le parseur à règles si la clé est absente ou la réponse inexploitable ;
 * les erreurs d'appel (clé invalide, réseau, quota) sont remontées à l'UI.
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
La phrase provient d'une TRANSCRIPTION VOCALE automatique : elle peut contenir des erreurs de reconnaissance, des homophones, des mots mal découpés, des parasites, des hésitations ou des auto-corrections. Interprète l'INTENTION du locuteur plutôt que le texte mot à mot.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"items":[{"aliment": string, "quantite": number, "unite": string, "estimation": boolean}]}
Aucun texte hors du JSON.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot","pincee","dose"].
- "aliment" : le nom de l'aliment en français, sans quantité ni adjectifs superflus.
- Si la quantité n'est pas donnée, choisis une quantité plausible et mets "estimation": true, sinon false.
- Corrige les erreurs de transcription évidentes vers l'aliment réellement voulu.
- Tiens compte des reformulations et auto-corrections : « de la viande hachée donc du bœuf 5 % de matière grasse » désigne UN seul aliment (steak haché de bœuf 5 %).
- Les déterminants et petits mots (un, une, en, le, des…) sont souvent mal transcrits : ne supprime PAS un aliment clairement nommé sous prétexte que son article semble bizarre (« une pêche en abricot » = « une pêche, un abricot »). Dans le doute, INCLUS l'aliment plutôt que de l'omettre.
- Si tu hésites entre plusieurs VARIANTES d'un même aliment (ex. fromage blanc 0 % vs 3 % vs skyr) sans indice dans la phrase, donne le nom générique sans trancher (« fromage blanc ») : l'application choisira la variante la plus consommée récemment par l'utilisateur.
- N'invente jamais de valeurs nutritionnelles.

Exemple (transcription bruitée) :
Entrée : "une pêche en abricot et 250 g de viande hachée donc de bœuf 5 % de matière grasse"
Raisonnement : « en abricot » = « un abricot » (déterminant mal transcrit), donc un second fruit ; « viande hachée … bœuf 5 % » = steak haché de bœuf 5 %.
Sortie : {"items":[{"aliment":"pêche","quantite":1,"unite":"piece","estimation":true},{"aliment":"abricot","quantite":1,"unite":"piece","estimation":true},{"aliment":"steak haché de bœuf 5%","quantite":250,"unite":"g","estimation":false}]}

Exemple :
Entrée : "un bol de riz avec 150 g de poulet et un yaourt nature"
Sortie : {"items":[{"aliment":"riz","quantite":1,"unite":"bol","estimation":false},{"aliment":"poulet","quantite":150,"unite":"g","estimation":false},{"aliment":"yaourt nature","quantite":1,"unite":"piece","estimation":false}]}`;

const IMAGE_SYSTEM_PROMPT = `Tu analyses la photo d'un repas et tu listes les aliments visibles avec une estimation de quantité.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"items":[{"aliment": string, "quantite": number, "unite": string, "estimation": boolean}]}
Aucun texte hors du JSON.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot","pincee","dose"].
- "aliment" : le nom de l'aliment en français, sans marque ni adjectifs superflus.
- Estime la quantité d'après ce que tu vois (taille des portions, du contenant) et mets TOUJOURS "estimation": true.
- N'invente jamais d'aliment non visible sur la photo. En cas de doute sur un aliment, ne l'inclus pas.
- Si aucun aliment n'est identifiable, réponds {"items":[]}.`;

/** Formats d'image acceptés par l'API vision d'Anthropic. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

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
    // clé invalide, réseau, quota… → erreur lisible pour l'UI
    throw e instanceof Anthropic.APIError
      ? new Error(`API Claude : ${e.message}`)
      : e;
  }
  return { items: parseTranscript(transcript), source: 'rules' };
}

/**
 * Extraction des aliments depuis une PHOTO via l'API Claude (vision).
 * Réservé au mode « API Claude » : nécessite un gros modèle multimodal.
 * `imageBase64` est la donnée base64 nue (sans le préfixe `data:…;base64,`).
 */
export async function extractImageWithAnthropic(
  imageBase64: string,
  mediaType: string,
  apiKey: string,
  model: string,
): Promise<{ items: ExtractedItem[]; source: 'anthropic' }> {
  if (!apiKey) throw new Error('Clé API requise pour analyser une photo.');
  if (!ACCEPTED_IMAGE_TYPES.includes(mediaType as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error('Format d’image non supporté (JPEG, PNG, WebP ou GIF).');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: IMAGE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: imageBase64,
              },
            },
            { type: 'text', text: 'Quels aliments et quelles quantités vois-tu sur cette photo ?' },
          ],
        },
      ],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const items = validateExtraction(extractJson(text));
    if (items && items.length > 0) return { items, source: 'anthropic' };
    return { items: [], source: 'anthropic' };
  } catch (e) {
    throw e instanceof Anthropic.APIError ? new Error(`API Claude : ${e.message}`) : e;
  }
}
