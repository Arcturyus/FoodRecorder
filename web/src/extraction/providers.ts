/**
 * Registre des fournisseurs d'IA « clé API ».
 *
 * Anthropic à part (SDK dédié), les cinq autres parlent tous le protocole
 * OpenAI `/chat/completions` — Gemini via sa couche de compatibilité officielle.
 * Un seul client les couvre donc tous (cf. openaiCompat.ts) : seuls l'URL de
 * base, le modèle et le libellé changent.
 *
 * Les identifiants de modèles VIEILLISSENT (Groq a déprécié Llama 3.3 en 2026,
 * les variantes « :free » d'OpenRouter tournent tous les mois). C'est pourquoi
 * chaque fournisseur accepte aussi un identifiant saisi à la main : la liste
 * ci-dessous est une commodité, jamais une limite.
 */

export type CloudProvider = 'anthropic' | 'gemini' | 'openai' | 'mistral' | 'openrouter' | 'groq';

export const CLOUD_PROVIDERS: CloudProvider[] = [
  'anthropic',
  'gemini',
  'openai',
  'mistral',
  'openrouter',
  'groq',
];

export interface ProviderModel {
  id: string;
  label: string;
  hint: string;
}

/**
 * Capacité photo. « selon-modele » = le fournisseur sert des modèles des deux
 * sortes (OpenRouter revend tout le marché, Mistral mélange multimodal et texte) :
 * on laisse passer l'appel et c'est l'erreur de l'API qui tranchera, plutôt que
 * d'interdire à tort.
 */
export type VisionSupport = 'oui' | 'selon-modele' | 'non';

export interface ProviderInfo {
  id: CloudProvider;
  label: string;
  /** Racine de l'API OpenAI-compatible ; `null` pour Anthropic (SDK dédié). */
  baseUrl: string | null;
  /** Forme attendue de la clé, affichée en placeholder. */
  keyPlaceholder: string;
  /** Où créer la clé (lien affiché dans les Réglages). */
  keyUrl: string;
  vision: VisionSupport;
  /** Ce qu'on obtient sans payer — affiché tel quel dans les Réglages. */
  freeTier: string;
  models: ProviderModel[];
}

export const PROVIDERS: Record<CloudProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    baseUrl: null,
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    vision: 'oui',
    freeTier: 'Pas de palier gratuit : le compte doit être crédité.',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'recommandé' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', hint: 'raisonnement le plus poussé' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'plus rapide, meilleur compromis' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'le plus rapide' },
    ],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPlaceholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    vision: 'oui',
    freeTier:
      'Palier gratuit disponible avec des quotas qui dépendent du modèle et du compte. Vérifiez les limites ' +
      'actuelles dans AI Studio. Google peut utiliser les données du palier gratuit pour améliorer ses produits.',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'dernier modèle stable' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'GPT (OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    vision: 'oui',
    freeTier: 'Pas de palier gratuit : le compte doit être crédité.',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', hint: 'par défaut, rapide et économe' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol', hint: 'plus puissant' },
    ],
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyPlaceholder: 'clé La Plateforme',
    keyUrl: 'https://console.mistral.ai/api-keys',
    vision: 'selon-modele',
    freeTier: 'Le plan Free annonce 10 $/mois de crédits API — très au-dessus de ce que consomme l’app.',
    models: [
      { id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5', hint: 'recommandé, multimodal' },
      { id: 'mistral-small-2603', label: 'Mistral Small 4', hint: 'plus rapide et économique' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    vision: 'selon-modele',
    freeTier:
      '50 requêtes/jour sans carte (1 000/jour après un achat unique de 10 $). Les modèles « :free » ' +
      'passent en dernier dans la file et peuvent être refusés aux heures chargées.',
    models: [
      { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', hint: 'rapide et économe' },
      { id: 'openai/gpt-6-sol', label: 'GPT-6 Sol', hint: 'plus puissant' },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', hint: 'raisonnement avancé' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'multimodal et rapide' },
      { id: 'qwen/qwen3.8-max-0902', label: 'Qwen 3.8 Max (0902)', hint: 'multimodal, outils' },
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'Nemotron 3 Ultra (gratuit)',
        hint: 'sans frais, sans garantie',
      },
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPlaceholder: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    vision: 'selon-modele',
    freeTier:
      'Palier gratuit avec limites variables selon le modèle et le compte. Vérifiez les quotas actuels dans la console Groq.',
    models: [
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', hint: 'dernier modèle, outils' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', hint: 'recommandé' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', hint: 'plus rapide et léger' },
    ],
  },
};

export const DEFAULT_CLOUD_PROVIDER: CloudProvider = 'openai';

/** Un fournisseur inconnu (persisté par une version future) retombe sur OpenAI. */
export function providerInfo(provider: CloudProvider): ProviderInfo {
  return PROVIDERS[provider] ?? PROVIDERS[DEFAULT_CLOUD_PROVIDER];
}

/** Modèle par défaut d'un fournisseur : le premier de sa liste. */
export function defaultModelFor(provider: CloudProvider): string {
  return providerInfo(provider).models[0].id;
}

const MODEL_ID_MIGRATIONS: Partial<Record<CloudProvider, Record<string, string>>> = {
  anthropic: {
    'claude-opus-4-8': 'claude-opus-5-5',
    'claude-opus-5': 'claude-opus-5-5',
  },
  gemini: {
    'gemini-3.7-flash': 'gemini-3.8-flash',
    'gemini-2.5-pro': 'gemini-3.8-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
    'gemini-2.5-flash-lite': 'gemini-3.8-flash',
  },
  openai: {
    'gpt-5-mini': 'gpt-6-luna',
    'gpt-5-nano': 'gpt-6-luna',
    'gpt-5.6-luna': 'gpt-6-luna',
    'gpt-5.6-terra': 'gpt-6-luna',
    'gpt-5.6-sol': 'gpt-6-sol',
  },
  mistral: {
    'mistral-large-latest': 'mistral-medium-3-5',
    'mistral-medium-latest': 'mistral-medium-3-5',
    'mistral-small-latest': 'mistral-small-2603',
    'ministral-8b-latest': 'mistral-small-2603',
  },
  openrouter: {
    'google/gemini-2.5-flash': 'google/gemini-3.8-flash',
    'openai/gpt-5-mini': 'openai/gpt-6-luna',
    'nvidia/nemotron-3.5-lightning:free': 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
  groq: {
    'qwen/qwen3.6-27b': 'qwen/qwen3.8-27b',
  },
};

/** Remplace les identifiants historiques que la liste intégrée ne propose plus. */
export function migrateCloudModelId(provider: CloudProvider, model: string): string {
  return MODEL_ID_MIGRATIONS[provider]?.[model] ?? model;
}

/** Ce fournisseur et ce modèle peuvent-ils analyser une photo ? */
export function supportsVision(provider: CloudProvider, model?: string): boolean {
  // Groq ne propose la vision que sur certains modèles (dont Qwen 3.8 27B).
  if (provider === 'groq' && /^(?:openai\/)?gpt-oss-/.test(model ?? '')) return false;
  return providerInfo(provider).vision !== 'non';
}

/**
 * Qui a produit une donnée extraite (repas, pesée, exposition au soleil).
 * Vit ici plutôt que dans le store : c'est la liste des moteurs, et providers.ts
 * n'importe rien — ce qui évite un cycle entre le store et le module des poids.
 *
 * Les deux valeurs historiques sont conservées telles quelles, car elles sont
 * déjà écrites dans l'historique synchronisé de tous les appareils :
 * 'anthropic' (clé API Claude) et 'claudecode' (pont vers le CLI `claude`).
 */
export type ExtractionSource = CloudProvider | 'claudecode' | 'codex' | 'llm' | 'rules' | 'manuel';

/**
 * Libellé court d'une source, pour l'historique. Le paramètre est volontairement
 * élargi à `string` : une entrée peut arriver par la synchro depuis un appareil
 * plus récent, avec une source que CETTE version ne connaît pas encore. Elle
 * s'affiche alors « IA » — jamais « manuel », qui serait un contresens.
 */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'manuel':
      return 'manuel';
    case 'rules':
      return 'auto';
    case 'llm':
      return 'IA locale';
    case 'claudecode':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    default:
      return PROVIDERS[source as CloudProvider]?.label ?? 'IA';
  }
}

/** Réglages effectifs d'un appel « clé API », résolus depuis le store. */
export interface CloudConfig {
  provider: CloudProvider;
  apiKey: string;
  model: string;
}
