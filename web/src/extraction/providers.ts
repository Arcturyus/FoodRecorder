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
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'le plus précis' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'bon compromis' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'le plus rapide et le moins cher' },
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
      'Gratuit sans carte bancaire (de l’ordre de 1 000 requêtes/jour sur Flash-Lite, 250/jour sur ' +
      'Flash, 100/jour sur Pro — le chiffre exact de votre compte est dans AI Studio). En contrepartie, ' +
      'Google annonce se servir des données du palier gratuit pour améliorer ses produits.',
    models: [
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', hint: 'recommandé' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'le plus précis, quota gratuit le plus serré' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'bon compromis' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', hint: 'le moins cher, plus gros quota' },
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
      { id: 'gpt-5-mini', label: 'GPT-5 mini', hint: 'recommandé' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: 'le plus précis' },
      { id: 'gpt-5-nano', label: 'GPT-5 nano', hint: 'le moins cher' },
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
      { id: 'mistral-large-latest', label: 'Mistral Large', hint: 'recommandé' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', hint: 'bon compromis' },
      { id: 'mistral-small-latest', label: 'Mistral Small', hint: 'le moins cher' },
      { id: 'ministral-8b-latest', label: 'Ministral 8B', hint: 'très léger, moins fiable ici' },
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
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'recommandé' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'le plus précis' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 mini', hint: 'bon compromis' },
      {
        id: 'nvidia/nemotron-3.5-lightning:free',
        label: 'Nemotron 3.5 Lightning (gratuit)',
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
    vision: 'non',
    freeTier:
      'Gratuit sans carte (14 400 requêtes/jour, 30/minute) MAIS plafonné à 6 000 tokens/minute : le ' +
      'prompt de l’app en fait à lui seul près de 5 000, ce qui limite en pratique à une saisie par minute.',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', hint: 'recommandé' },
      { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B', hint: 'plus léger' },
    ],
  },
};

export const DEFAULT_CLOUD_PROVIDER: CloudProvider = 'anthropic';

/** Un fournisseur inconnu (persisté par une version future) retombe sur Anthropic. */
export function providerInfo(provider: CloudProvider): ProviderInfo {
  return PROVIDERS[provider] ?? PROVIDERS[DEFAULT_CLOUD_PROVIDER];
}

/** Modèle par défaut d'un fournisseur : le premier de sa liste. */
export function defaultModelFor(provider: CloudProvider): string {
  return providerInfo(provider).models[0].id;
}

/** Ce fournisseur peut-il analyser une photo ? */
export function supportsVision(provider: CloudProvider): boolean {
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
