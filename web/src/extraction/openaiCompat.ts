import { providerInfo, type CloudConfig, type CloudProvider } from './providers';

/**
 * Client unique pour tous les fournisseurs qui parlent le protocole OpenAI
 * `/chat/completions` : OpenAI, Mistral, OpenRouter, Groq, et Gemini via sa
 * couche de compatibilité officielle. Anthropic garde son SDK (cf. cloud.ts).
 *
 * Écrit en `fetch` nu plutôt qu'avec le SDK OpenAI : la requête tient en vingt
 * lignes, et cela évite d'embarquer une dépendance de plus dans le bundle pour
 * cinq fournisseurs dont on n'utilise qu'un seul endpoint.
 *
 * Deux divergences connues entre fournisseurs, traitées ici :
 *  - les modèles GPT-5 refusent `max_tokens` (il faut `max_completion_tokens`)
 *    et n'acceptent que la température par défaut ;
 *  - on n'impose PAS `response_format: json_object` : tous les modèles ne le
 *    supportent pas, et l'app sait déjà extraire le premier objet JSON d'un
 *    texte (cf. `extractJson`). Mieux vaut un JSON à repêcher qu'un 400.
 */

/** Un morceau de message : du texte, ou une image pour les modèles multimodaux. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface CompatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

/** OpenAI a renommé le plafond de sortie sur les modèles récents. */
function maxTokensField(provider: CloudProvider): 'max_tokens' | 'max_completion_tokens' {
  return provider === 'openai' ? 'max_completion_tokens' : 'max_tokens';
}

/**
 * Message d'erreur lisible : les fournisseurs renvoient soit un JSON
 * `{error:{message}}`, soit du texte brut, soit rien du tout.
 */
async function readError(res: Response, label: string): Promise<Error> {
  const raw = await res.text().catch(() => '');
  let detail = raw.slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as CompletionResponse;
    if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // pas du JSON : on garde le texte brut tronqué
  }
  const quota = res.status === 429 ? ' (quota ou limite de débit atteinte)' : '';
  return new Error(`${label} : HTTP ${res.status}${quota}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Appel générique. Lève une erreur lisible (clé invalide, quota, réseau,
 * modèle inconnu) — c'est à l'appelant de décider s'il replie ou remonte.
 */
export async function chatOpenAICompat(
  messages: CompatMessage[],
  cfg: CloudConfig,
  opts?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const info = providerInfo(cfg.provider);
  if (!info.baseUrl) throw new Error(`${info.label} n’utilise pas le protocole OpenAI.`);
  if (!cfg.apiKey) throw new Error(`Clé API ${info.label} manquante — voir Réglages.`);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    [maxTokensField(cfg.provider)]: opts?.maxTokens ?? 1024,
  };
  // Les modèles GPT-5 n'acceptent que la température par défaut ; ailleurs, 0
  // stabilise l'extraction (même phrase → mêmes aliments).
  if (cfg.provider !== 'openai') body.temperature = 0;

  let res: Response;
  try {
    res = await fetch(`${info.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        // Courtoisie OpenRouter : identifie l'app dans leurs tableaux de bord.
        ...(cfg.provider === 'openrouter' ? { 'X-Title': 'FoodRecorder' } : {}),
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (e) {
    // Échec réseau — chez certains fournisseurs c'est aussi la signature d'un
    // refus CORS, que le navigateur ne laisse pas distinguer d'une coupure.
    throw new Error(
      `${info.label} injoignable : ${(e as Error).message}. Vérifiez la connexion ` +
        '(et, sur cet appareil, que le fournisseur autorise les appels depuis un navigateur).',
    );
  }

  if (!res.ok) throw await readError(res, info.label);

  const data = (await res.json().catch(() => ({}))) as CompletionResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

/** Variante photo : l'image part en `data:` URI, format attendu par le protocole. */
export async function chatOpenAICompatImage(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mediaType: string,
  cfg: CloudConfig,
  opts?: { maxTokens?: number },
): Promise<string> {
  return chatOpenAICompat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: 'text', text: userText },
        ],
      },
    ],
    cfg,
    opts,
  );
}
