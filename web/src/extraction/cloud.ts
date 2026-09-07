import Anthropic from '@anthropic-ai/sdk';
import { providerInfo, type CloudConfig } from './providers';
import { chatOpenAICompat, chatOpenAICompatImage, type CompatMessage } from './openaiCompat';

/**
 * Façade unique du mode « clé API ».
 *
 * Tout le reste de l'app (extraction d'un repas, d'une pesée, d'une exposition
 * au soleil, vérification des matchs, relecture d'un aliment) passe par ces
 * trois fonctions et ignore le fournisseur choisi. Ajouter un fournisseur, c'est
 * donc une entrée dans providers.ts — pas une branche de plus dans chaque module.
 *
 * Deux chemins seulement derrière : le SDK Anthropic, et le client OpenAI-
 * compatible qui couvre les cinq autres.
 */

/** Tour de conversation, indépendant du fournisseur. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** La clé est-elle renseignée pour le fournisseur actif ? */
export function hasCloudKey(cfg: CloudConfig): boolean {
  return cfg.apiKey.trim().length > 0;
}

function anthropicClient(cfg: CloudConfig): Anthropic {
  return new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
}

function anthropicText(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Erreur d'API remise en français, préfixée du fournisseur. */
function wrap(e: unknown, cfg: CloudConfig): Error {
  const label = providerInfo(cfg.provider).label;
  if (e instanceof Anthropic.APIError) return new Error(`${label} : ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

/** Conversation multi-tours (relecture d'un aliment). */
export async function askCloudChat(
  system: string,
  turns: ChatTurn[],
  cfg: CloudConfig,
  opts?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const maxTokens = opts?.maxTokens ?? 2048;
  try {
    if (cfg.provider === 'anthropic') {
      const resp = await anthropicClient(cfg).messages.create(
        { model: cfg.model, max_tokens: maxTokens, system, messages: turns },
        { signal: opts?.signal },
      );
      return anthropicText(resp);
    }
    const messages: CompatMessage[] = [{ role: 'system', content: system }, ...turns];
    return await chatOpenAICompat(messages, cfg, { maxTokens, signal: opts?.signal });
  } catch (e) {
    throw wrap(e, cfg);
  }
}

/** Appel simple system + user, le cas de loin le plus fréquent. */
export function askCloud(
  system: string,
  user: string,
  cfg: CloudConfig,
  opts?: { maxTokens?: number },
): Promise<string> {
  return askCloudChat(system, [{ role: 'user', content: user }], cfg, opts);
}

/** Formats d'image acceptés — intersection de ce que prennent les fournisseurs. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** Analyse d'une photo. Lève si le modèle choisi n'est pas multimodal. */
export async function askCloudImage(
  system: string,
  userText: string,
  imageBase64: string,
  mediaType: string,
  cfg: CloudConfig,
  opts?: { maxTokens?: number },
): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(mediaType as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error('Format d’image non supporté (JPEG, PNG, WebP ou GIF).');
  }
  const maxTokens = opts?.maxTokens ?? 1024;
  try {
    if (cfg.provider === 'anthropic') {
      const resp = await anthropicClient(cfg).messages.create({
        model: cfg.model,
        max_tokens: maxTokens,
        system,
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
              { type: 'text', text: userText },
            ],
          },
        ],
      });
      return anthropicText(resp);
    }
    return await chatOpenAICompatImage(system, userText, imageBase64, mediaType, cfg, { maxTokens });
  } catch (e) {
    throw wrap(e, cfg);
  }
}
