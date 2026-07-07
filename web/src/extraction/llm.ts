import type { ExtractedItem } from '../nutrition/types';
import { extractionJsonSchema, validateExtraction } from './schema';
import { parseTranscript } from './ruleParser';

/**
 * Extraction par LLM on-device via WebLLM (WebGPU).
 * Le module est chargé dynamiquement pour ne pas alourdir le bundle initial.
 * Fallback systématique sur le parseur à règles si le LLM échoue.
 */

export interface LlmModelOption {
  id: string;
  label: string;
  sizeHint: string;
}

/** Modèles proposés, du plus léger au plus costaud (ordi → futur mobile). */
export const LLM_MODELS: LlmModelOption[] = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B (léger)', sizeHint: '~0,5 Go' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B (recommandé)', sizeHint: '~1,0 Go' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (plus précis)', sizeHint: '~1,8 Go' },
];

export const DEFAULT_LLM_MODEL = LLM_MODELS[1].id;

const SYSTEM_PROMPT = `Tu extrais les aliments d'une phrase en français décrivant un repas.
Réponds UNIQUEMENT avec un JSON {"items":[{"aliment","quantite","unite","estimation"}]}.
- "unite" ∈ ["g","ml","piece","portion","cas","cac","bol","verre","assiette","tranche","poignee","carre","pot"].
- "aliment" : le nom de l'aliment, en français, sans quantité ni adjectifs superflus.
- Si la quantité n'est pas donnée, choisis une quantité plausible et mets "estimation": true, sinon false.
- N'invente JAMAIS de valeurs nutritionnelles. N'ajoute aucun aliment non mentionné.

Exemples :
"j'ai mangé un bol de riz avec 150 g de poulet et un yaourt nature"
→ {"items":[{"aliment":"riz","quantite":1,"unite":"bol","estimation":false},{"aliment":"poulet","quantite":150,"unite":"g","estimation":false},{"aliment":"yaourt nature","quantite":1,"unite":"piece","estimation":false}]}

"euh ce midi j'ai pris genre des pâtes avec du fromage râpé"
→ {"items":[{"aliment":"pâtes","quantite":1,"unite":"assiette","estimation":true},{"aliment":"fromage râpé","quantite":2,"unite":"cas","estimation":true}]}

"deux œufs au plat, une demi-baguette et trois carrés de chocolat noir"
→ {"items":[{"aliment":"œuf au plat","quantite":2,"unite":"piece","estimation":false},{"aliment":"baguette","quantite":0.5,"unite":"piece","estimation":false},{"aliment":"chocolat noir","quantite":3,"unite":"carre","estimation":false}]}`;

type Engine = {
  chat: {
    completions: {
      create(req: unknown): Promise<{ choices: { message: { content?: string | null } }[] }>;
    };
  };
};

let engine: Engine | null = null;
let loadedModelId: string | null = null;

export type ProgressCallback = (text: string, progress: number) => void;

export async function loadLlm(modelId: string, onProgress?: ProgressCallback): Promise<void> {
  if (engine && loadedModelId === modelId) return;
  const webllm = await import('@mlc-ai/web-llm');
  if (engine && loadedModelId !== modelId) {
    await (engine as unknown as { unload(): Promise<void> }).unload().catch(() => {});
    engine = null;
  }
  engine = (await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress?.(r.text, r.progress),
  })) as unknown as Engine;
  loadedModelId = modelId;
}

export function isLlmLoaded(): boolean {
  return engine !== null;
}

export function loadedModel(): string | null {
  return loadedModelId;
}

/**
 * Extrait les items via le LLM chargé. Une tentative + un retry,
 * puis fallback sur le parseur à règles (comme prévu au plan §Phase 3).
 */
export async function extractWithLlm(transcript: string): Promise<{ items: ExtractedItem[]; source: 'llm' | 'rules' }> {
  if (!engine) return { items: parseTranscript(transcript), source: 'rules' };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object', schema: JSON.stringify(extractionJsonSchema) },
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) continue;
      const items = validateExtraction(JSON.parse(content));
      if (items && items.length > 0) return { items, source: 'llm' };
    } catch {
      // retry puis fallback
    }
  }
  return { items: parseTranscript(transcript), source: 'rules' };
}
