import type { ExtractedItem } from '../nutrition/types';
import { validateExtraction } from './schema';
import { parseTranscript } from './ruleParser';

/**
 * Extraction via le CLI « Claude Code » (pont local).
 *
 * Ne marche que sur l'ordinateur qui exécute l'app (`npm run dev`) avec le CLI
 * « claude » installé et DÉJÀ connecté (abonnement Pro/Max) : aucune clé API,
 * aucun identifiant à saisir — on réutilise la session du CLI. Le navigateur
 * appelle le middleware /api/claude-code (cf. vite-plugin-claude-code.ts), qui
 * lance le CLI. Repli sur le parseur à règles si le pont/CLI est indisponible.
 */

const SYSTEM_PROMPT = `Tu extrais les aliments d'une phrase en français décrivant un repas.
La phrase provient d'une TRANSCRIPTION VOCALE automatique : elle peut contenir des erreurs de reconnaissance, des homophones, des mots mal découpés, des parasites, des hésitations ou des auto-corrections. Interprète l'INTENTION du locuteur plutôt que le texte mot à mot.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"items":[{"aliment": string, "quantite": number, "unite": string, "estimation": boolean}]}
Aucun texte hors du JSON, pas de bloc de code.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot","pincee","dose"].
- "aliment" : le nom de l'aliment en français, sans quantité ni adjectifs superflus.
- Si la quantité n'est pas donnée, choisis une quantité plausible et mets "estimation": true, sinon false.
- Corrige les erreurs de transcription évidentes vers l'aliment réellement voulu.
- Tiens compte des reformulations et auto-corrections : « de la viande hachée donc du bœuf 5 % de matière grasse » désigne UN seul aliment (steak haché de bœuf 5 %).
- Les déterminants et petits mots (un, une, en, le, des…) sont souvent mal transcrits : ne supprime PAS un aliment clairement nommé sous prétexte que son article semble bizarre (« une pêche en abricot » = « une pêche, un abricot »). Dans le doute, INCLUS l'aliment plutôt que de l'omettre.
- N'invente jamais de valeurs nutritionnelles.

Exemple (transcription bruitée) :
Entrée : "une pêche en abricot et 250 g de viande hachée donc de bœuf 5 % de matière grasse"
Raisonnement : « en abricot » = « un abricot » (déterminant mal transcrit), donc un second fruit ; « viande hachée … bœuf 5 % » = steak haché de bœuf 5 %.
Sortie : {"items":[{"aliment":"pêche","quantite":1,"unite":"piece","estimation":true},{"aliment":"abricot","quantite":1,"unite":"piece","estimation":true},{"aliment":"steak haché de bœuf 5%","quantite":250,"unite":"g","estimation":false}]}`;

function buildPrompt(transcript: string): string {
  return `${SYSTEM_PROMPT}\n\nPhrase : "${transcript}"\nJSON :`;
}

const IMAGE_SYSTEM_PROMPT = `Tu analyses la photo d'un repas et tu listes les aliments visibles avec une estimation de quantité.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"items":[{"aliment": string, "quantite": number, "unite": string, "estimation": boolean}]}
Aucun texte hors du JSON, pas de bloc de code.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot","pincee","dose"].
- "aliment" : le nom de l'aliment en français, sans marque ni adjectifs superflus.
- Estime la quantité d'après ce que tu vois (taille des portions, du contenant) et mets TOUJOURS "estimation": true.
- N'invente jamais d'aliment non visible sur la photo. En cas de doute sur un aliment, ne l'inclus pas.
- Si aucun aliment n'est identifiable, réponds {"items":[]}.`;

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

export interface ClaudeCodeStatus {
  available: boolean;
  version?: string;
  error?: string;
}

/** Santé du pont + du CLI (le middleware n'existe qu'en dev, sur l'ordinateur). */
export async function checkClaudeCode(): Promise<ClaudeCodeStatus> {
  try {
    const res = await fetch('/api/claude-code');
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    return (await res.json()) as ClaudeCodeStatus;
  } catch (e) {
    return { available: false, error: (e as Error).message };
  }
}

/**
 * Extraction des aliments depuis une PHOTO via le pont Claude Code : l'image est
 * envoyée au middleware qui l'écrit en fichier temporaire, et le CLI (multimodal)
 * la lit directement. Pas de repli règles possible (rien à parser sans texte).
 */
export async function extractImageWithClaudeCode(
  imageBase64: string,
  mediaType: string,
): Promise<{ items: ExtractedItem[]; source: 'claudecode' }> {
  try {
    const res = await fetch('/api/claude-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${IMAGE_SYSTEM_PROMPT}\n\nJSON :`,
        image: { data: imageBase64, mediaType },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const items = validateExtraction(extractJson(data.text ?? ''));
    return { items: items ?? [], source: 'claudecode' };
  } catch (e) {
    throw e instanceof Error ? new Error(`Pont Claude Code : ${e.message}`) : e;
  }
}

export async function extractWithClaudeCode(
  transcript: string,
): Promise<{ items: ExtractedItem[]; source: 'claudecode' | 'rules' }> {
  try {
    const res = await fetch('/api/claude-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(transcript) }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const items = validateExtraction(extractJson(data.text ?? ''));
    if (items && items.length > 0) return { items, source: 'claudecode' };
  } catch (e) {
    throw e instanceof Error ? new Error(`Pont Claude Code : ${e.message}`) : e;
  }
  return { items: parseTranscript(transcript), source: 'rules' };
}
