import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ComputedItem,
  ExtractedItem,
  Food,
  FoodCategory,
  Nutrients,
  NutrientKey,
  Unit,
} from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { computeItems, totalNutrients, toGrams, scaleNutrients, normalizeNutrients } from '../nutrition/compute';
import { FOOD_BY_ID } from '../nutrition/foods';
import {
  adoptFromCatalog,
  findBankFood,
  ingestEstimates,
  mergeBankFoods,
  migrateToPersonalBank,
} from '../nutrition/bank';
import { DEFAULT_LLM_MODEL } from '../extraction/llm';
import {
  DEFAULT_CLOUD_PROVIDER,
  defaultModelFor,
  type CloudConfig,
  type CloudProvider,
  type ExtractionSource,
} from '../extraction/providers';
import { DEFAULT_STT_MODEL } from '../stt/whisper';
import { isNativeSttSupported } from '../stt/webspeech';
import { normalizeForMatch } from '../nutrition/normalize';
import { isPhotoEntry } from '../nutrition/uncertainty';
import { DEFAULT_PROFILE } from '../nutrition/targets';
import type { Profile, TargetOverride, TargetOverrides } from '../nutrition/targets';
import type { BodyMeasurementEntry, WeightEntry, WeightConfig } from '../weight/types';
import { SEED_WEIGHT_ENTRIES, SEED_WEIGHT_CONFIG } from '../weight/seed';
import type { SunExposure } from '../sun/vitaminD';
import { normalizeCreme } from '../sun/vitaminD';

/** Un item enregistré dans le journal (résolu et éditable). */
export interface JournalItem {
  id: string;
  foodId: string | null;
  nomAffiche: string;
  quantite: number;
  unite: ExtractedItem['unite'];
  grams: number;
  nutrients: Nutrients;
  estimation: boolean;
  douteux: boolean;
  /**
   * Catégorie d'un aliment NON résolu (estimé par l'IA, ou introuvable dans la
   * banque) : sans elle, ces items échappent à tout filtre par catégorie —
   * or ce sont justement les plats décrits par le LLM (pizza, poke bowl…).
   * Les items résolus n'en portent pas : ils tiennent la leur de la banque.
   */
  categorie?: FoodCategory;
  /**
   * Fourchette plausible de quantité (même unité que `quantite`) fournie par
   * l'IA quand elle a estimé la quantité (photo surtout). Sert au calcul de
   * l'incertitude des totaux ; annulée si l'utilisateur corrige la quantité.
   */
  quantiteMin?: number;
  quantiteMax?: number;
  /**
   * Nutriments estimés par une IA forte pour un aliment ABSENT de la base
   * (pour 100 g, + poids d'une pièce). Présent ⇒ item mis en évidence dans
   * l'historique pour vérification. Conservé pour rescaler à l'édition.
   */
  iaEstime?: { n: Nutrients; pieceGrams?: number };
  /**
   * Ajustement « pour cette fois » : valeurs nutritionnelles (pour 100 g)
   * propres à CET item, prioritaires sur l'aliment/estimation associés (ex.
   * un pain plus protéiné ce jour-là) sans créer un nouvel aliment. L'aliment
   * reste associé (foodId / iaEstime) pour la seule conversion unité → grammes.
   * Rescalé automatiquement si la quantité change.
   */
  customN?: Nutrients;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  transcript: string;
  /**
   * Qui a produit cette entrée. Les valeurs historiques ('anthropic' pour la
   * clé API Claude, 'claudecode' pour le pont) sont conservées : elles existent
   * déjà dans l'historique synchronisé de tous les appareils. Les nouvelles
   * nomment le fournisseur réellement utilisé. Un appareil pas encore à jour
   * qui reçoit une source qu'il ne connaît pas l'affiche simplement « IA ».
   */
  source: ExtractionSource;
  items: JournalItem[];
  /**
   * Correction du regroupement en repas (cf. ui/meals.ts), quand la règle
   * automatique — deux saisies à moins de 30 min sont le même repas — se
   * trompe : 'join' rattache cette entrée au repas précédent malgré l'écart,
   * 'break' en ouvre un nouveau ici. Absent = automatique.
   *
   * C'est une annotation, pas une fusion : les entrées restent séparées, et
   * effacer le champ fait revenir au calcul. Posée SUR l'entrée, elle suit la
   * synchro et les sauvegardes sans qu'il y ait rien à câbler.
   */
  mealLink?: 'join' | 'break';
}

// Ré-export : le reste de l'app importe historiquement `normalizeNutrients`
// depuis le store, alors qu'elle vit désormais avec les autres calculs.
export { normalizeNutrients };

/**
 * Choix du moteur d'extraction. Les deux dernières valeurs datent de l'époque
 * où l'app ne connaissait que Claude ; elles sont CONSERVÉES telles quelles
 * (elles sont persistées sur tous les appareils) mais désignent désormais la
 * FAMILLE de moteur, le fournisseur exact vivant à côté :
 *  - 'cloud'      → une clé API, chez `cloudProvider` ;
 *  - 'claudecode' → un pont vers un CLI local, celui de `cliBridge`.
 */
export type ExtractionMode = 'rules' | 'local' | 'cloud' | 'claudecode';

/** CLI local utilisé par le pont (mode 'claudecode'). */
export type CliBridge = 'claude' | 'codex';

/** Choix du moteur de transcription vocale. */
export type SttEngine = 'whisper' | 'native';

/** Patch d'aliment : champs optionnels + nutriments partiels (fusionnés à l'application). */
export type FoodPatch = Partial<Omit<Food, 'n'>> & { n?: Partial<Nutrients> };
/**
 * ANCIEN modèle : modifications utilisateur sur les aliments du catalogue en dur.
 * N'existe plus dans l'état courant — les aliments de ma banque sont des objets
 * complets, édités directement. Le type survit pour lire les données persistées
 * et les sauvegardes d'avant la migration (cf. `migrateToPersonalBank`).
 */
export type FoodOverrides = Record<string, FoodPatch>;

/**
 * Version du schéma de la banque. 2 = banque personnelle (les aliments consommés
 * sont des objets à part entière) ; absent/1 = ancien modèle (catalogue en dur +
 * overrides + estimations IA enfermées dans les items). Déclenche la migration.
 */
export const BANK_SCHEMA_VERSION = 2;

/** Item d'un repas favori : référence légère, re-résolue à chaque application. */
export interface FavoriteMealItem {
  foodId: string | null;
  nomAffiche: string;
  quantite: number;
  unite: Unit;
  estimation: boolean;
}

/** Repas type réutilisable (« petit-déj habituel »), ajouté en un clic ou à la voix. */
export interface FavoriteMeal {
  id: string;
  nom: string;
  items: FavoriteMealItem[];
}

/** Date locale (pas UTC : entre minuit et 2 h, toISOString daterait de la veille). */
function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Heure locale HH:MM (défaut pratique pour une nouvelle pesée). */
function nowTime(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clé de tri chronologique d'une pesée (date puis heure). */
function weightOrder(e: Pick<WeightEntry, 'date' | 'heure'>): string {
  return `${e.date} ${e.heure}`;
}

/** Poids de la pesée la plus récente d'une liste (pour synchroniser le profil). */
function latestWeight(entries: WeightEntry[]): number | null {
  if (entries.length === 0) return null;
  let latest = entries[0];
  for (const e of entries) if (weightOrder(e) > weightOrder(latest)) latest = e;
  return latest.poids;
}

/**
 * Réglages effectifs du mode « clé API » : fournisseur actif + sa clé + son
 * modèle. Un fournisseur sans modèle retenu prend le premier de sa liste, ce
 * qui évite d'écrire un défaut dans le storage tant que rien n'a été choisi.
 */
export function cloudConfigOf(s: Pick<AppState, 'cloudProvider' | 'cloudApiKeys' | 'cloudModels'>): CloudConfig {
  return {
    provider: s.cloudProvider,
    apiKey: s.cloudApiKeys[s.cloudProvider] ?? '',
    model: s.cloudModels[s.cloudProvider] ?? defaultModelFor(s.cloudProvider),
  };
}

/** Hook : réglages du fournisseur actif (cf. cloudConfigOf). */
export function useCloudConfig(): CloudConfig {
  const cloudProvider = useStore((s) => s.cloudProvider);
  const cloudApiKeys = useStore((s) => s.cloudApiKeys);
  const cloudModels = useStore((s) => s.cloudModels);
  return cloudConfigOf({ cloudProvider, cloudApiKeys, cloudModels });
}

/**
 * MA BANQUE : les aliments réellement consommés — seule source du matching, des
 * calculs et des stats. Le catalogue de référence (`FOODS`) n'en fait PAS partie :
 * un aliment jamais mangé n'a rien à faire dans les totaux ni dans l'explorateur.
 * Il n'y entre qu'une fois copié (cf. `adoptFromCatalog`), en gardant son id.
 */
export function effectiveFoods(customFoods: Food[]): Food[] {
  return customFoods;
}

/**
 * Résout un aliment par son id : ma banque d'abord, le catalogue en dernier
 * recours. Ce repli couvre un item du journal qui référencerait un aliment
 * retiré de la banque (ou pas encore migré) : mieux vaut les vraies valeurs du
 * catalogue que le snapshot figé de l'item.
 */
export function effectiveFoodById(id: string, customFoods: Food[]): Food | null {
  return customFoods.find((f) => f.id === id) ?? FOOD_BY_ID.get(id) ?? null;
}

/** Hook : ma banque d'aliments. */
export function useEffectiveFoods(): Food[] {
  return useStore((s) => s.customFoods);
}

/**
 * Fréquence de consommation par aliment sur les `days` derniers jours
 * (foodId → nb d'occurrences). Sert à départager les hésitations du matching :
 * à scores proches, on choisit l'aliment le plus mangé récemment.
 */
export function recentFoodCounts(entries: JournalEntry[], days = 14): Map<string, number> {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const cutoff = todayStr(d);
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.date < cutoff) continue;
    for (const it of e.items) {
      if (it.foodId) counts.set(it.foodId, (counts.get(it.foodId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Transcript d'une entrée dupliquée : on ne recopie PAS la dictée d'origine.
 * Elle décrit un repas d'un autre jour (« ce midi j'ai mangé… »), elle encombre
 * la carte, et elle repartirait ensuite comme nom de favori proposé. Seul le
 * marqueur photo est conservé : `isPhotoEntry` s'en sert pour majorer
 * l'incertitude des quantités devinées à l'œil, qui vaut aussi pour la copie.
 */
function copiedTranscript(transcript: string): string {
  return isPhotoEntry({ transcript }) ? '📷 Photo' : '';
}

/** Convertit un ComputedItem (matching brut) en JournalItem (résolu). */
export function toJournalItem(ci: ComputedItem): JournalItem {
  return {
    id: uid(),
    foodId: ci.match.food?.id ?? null,
    nomAffiche: ci.match.food?.nom ?? ci.extracted.aliment,
    quantite: ci.extracted.quantite,
    unite: ci.extracted.unite,
    grams: ci.grams,
    nutrients: ci.nutrients ?? { ...EMPTY_NUTRIENTS },
    estimation: ci.extracted.estimation,
    ...(ci.extracted.quantiteMin != null && ci.extracted.quantiteMax != null
      ? { quantiteMin: ci.extracted.quantiteMin, quantiteMax: ci.extracted.quantiteMax }
      : {}),
    // Catégorie : seulement pour un aliment non résolu (sinon c'est la banque qui
    // fait foi, et la garder ici la figerait à la valeur du jour de la saisie).
    ...(!ci.match.food && ci.extracted.categorie ? { categorie: ci.extracted.categorie } : {}),
    // Un aliment estimé par l'IA n'est pas « douteux » (valeurs fournies) : il porte
    // son propre repère `iaEstime` (mise en évidence + vérification recommandée).
    douteux: !ci.aiEstime && (ci.match.douteux || ci.match.food === null),
    ...(ci.aiEstime && ci.extracted.nutriments
      ? { iaEstime: { n: ci.extracted.nutriments, pieceGrams: ci.extracted.grammesParPiece } }
      : {}),
  };
}

interface AppState {
  entries: JournalEntry[];
  /**
   * MA BANQUE d'aliments : tout ce qui a été mangé au moins une fois, quelle que
   * soit sa provenance (copie du catalogue, estimation IA, saisie manuelle). Le
   * nom du champ est resté `customFoods` pour ne pas casser la table Supabase
   * `custom_foods` déjà syncée sur les appareils.
   */
  customFoods: Food[];
  /** Version du schéma de la banque (cf. BANK_SCHEMA_VERSION). */
  bankSchemaVersion: number;
  sttEngine: SttEngine;
  sttModel: string;
  llmModel: string;
  extractionMode: ExtractionMode;
  /** Fournisseur actif du mode « clé API ». */
  cloudProvider: CloudProvider;
  /** Une clé par fournisseur : on n'en perd pas une en changeant d'avis. */
  cloudApiKeys: Partial<Record<CloudProvider, string>>;
  /** Un modèle retenu par fournisseur (absent = le premier de sa liste). */
  cloudModels: Partial<Record<CloudProvider, string>>;
  /** CLI visé par le pont local. */
  cliBridge: CliBridge;
  /** Modèle retenu par CLI local (absent = modèle par défaut de cette CLI). */
  cliModels: Partial<Record<CliBridge, string>>;
  /**
   * ANCIENS champs mono-fournisseur (Anthropic). Plus lus par l'app : ils ont
   * été recopiés dans `cloudApiKeys`/`cloudModels` à l'hydratation. On les
   * laisse en place — et donc persistés — pour qu'un retour à une version
   * antérieure retrouve la clé de l'utilisateur au lieu d'un champ vide.
   */
  cloudApiKey: string;
  cloudModel: string;
  profile: Profile;
  weightEntries: WeightEntry[];
  bodyMeasurements: BodyMeasurementEntry[];
  weightConfig: WeightConfig;
  favoriteMeals: FavoriteMeal[];
  /** Expositions au soleil (gain de vitamine D estimé, hors journal alimentaire). */
  sunExposures: SunExposure[];
  /** Identifiant stable de cet appareil (généré une fois), pour la synchro multi-appareils. */
  deviceId: string;
  /** Horodatage de la dernière entrée synchronisée reçue d'un autre appareil. */
  syncCursor: string | null;
  /** Jour (YYYY-MM-DD) de la dernière sauvegarde automatique écrite sur le disque. */
  lastAutoSave: string | null;
  /**
   * Overrides explicites du « mute » par jour (YYYY-MM-DD). `true` = jour exclu des
   * moyennes (mal rempli). `false` = jour vide forcé compté (jeûne à 0). Une date
   * absente suit le défaut : un jour rempli compte, un jour vide ne compte pas.
   */
  mutedDays: Record<string, boolean>;
  /**
   * Notes libres par jour (YYYY-MM-DD → texte). Purement informatif : aucun impact
   * sur les moyennes/stats/calculs (mémo rattaché au jour, ex. « coup de soleil torse
   * et dos »). Sparse : seuls les jours annotés y figurent (chaîne vide ⇒ clé effacée).
   */
  dayNotes: Record<string, string>;
  /**
   * Overrides d'importance par nutriment (multiplie le poids d'un manque/excès dans
   * les recommandations et conseils). Sparse : seuls les nutriments réglés par
   * l'utilisateur y figurent ; le reste suit le défaut RDA (cf. `effectiveImportance`).
   */
  nutrientImportance: Partial<Record<NutrientKey, number>>;

  /**
   * Cibles (AJR / optimal) réglées à la main, par nutriment. Sparse comme
   * `nutrientImportance` : un nutriment absent suit intégralement le calcul de
   * `computeTargets`, et suivra ses évolutions futures.
   */
  nutrientTargets: TargetOverrides;

  setSttEngine: (e: SttEngine) => void;
  setSttModel: (id: string) => void;
  setLlmModel: (id: string) => void;
  setExtractionMode: (m: ExtractionMode) => void;
  setCloudProvider: (p: CloudProvider) => void;
  setCloudApiKey: (k: string) => void;
  setCloudModel: (id: string) => void;
  setCliBridge: (c: CliBridge) => void;
  setCliModel: (cli: CliBridge, id: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  setSyncCursor: (cursor: string) => void;
  setLastAutoSave: (day: string) => void;

  /**
   * Fixe le « mute » d'un jour. `muted` true = exclu des moyennes ; false = jour vide
   * compté comme jeûne (0). L'override est effacé s'il rejoint le défaut du jour
   * (rempli → compté, vide → non compté) pour garder la map compacte.
   */
  setDayMute: (date: string, muted: boolean) => void;
  /** Bascule le « compté / non compté » d'un jour (utilise le défaut selon son remplissage). */
  toggleDayMute: (date: string) => void;

  /** Fixe la note libre d'un jour. Une chaîne vide (après trim) efface la note. */
  setDayNote: (date: string, note: string) => void;

  /** Fixe l'importance d'un nutriment (multiplie son poids dans les reco/conseils). */
  setNutrientImportance: (key: NutrientKey, value: number) => void;
  /** Efface l'override d'importance d'un nutriment (retour au défaut RDA). */
  resetNutrientImportance: (key: NutrientKey) => void;
  /** Efface tous les overrides d'importance (retour aux défauts RDA). */
  resetAllNutrientImportance: () => void;

  /**
   * Règle une cible d'un nutriment. Le patch est FUSIONNÉ avec l'existant, et
   * un champ mis à `undefined` est retiré — c'est ainsi qu'on revient à la
   * valeur conseillée pour l'AJR sans perdre l'optimal réglé juste à côté.
   */
  setNutrientTarget: (key: NutrientKey, patch: TargetOverride) => void;
  /** Efface le réglage de cible d'un nutriment (retour aux valeurs conseillées). */
  resetNutrientTarget: (key: NutrientKey) => void;
  /** Efface tous les réglages de cibles. */
  resetAllNutrientTargets: () => void;

  /** Enregistre automatiquement une entrée (auto-validation, plan §Phase 4). */
  /**
   * Ajoute un repas extrait (voix/texte/photo). `date` : jour ciblé (défaut
   * aujourd'hui). `createdAt` : heure de saisie (epoch ms) — passée par la synchro
   * pour refléter l'heure d'ENVOI depuis l'appareil émetteur plutôt que l'heure de
   * traitement différé ; défaut `Date.now()`.
   */
  addEntry: (transcript: string, items: ExtractedItem[], source: JournalEntry['source'], date?: string, createdAt?: number) => string;
  /** Ajout manuel d'un aliment choisi explicitement (pas de matching flou). `date` : jour ciblé (défaut aujourd'hui). */
  addFoodEntry: (food: Food, quantite: number, unite: Unit, date?: string) => string;
  /** Ajoute un aliment explicitement choisi à une entrée existante, sans créer un nouveau repas. */
  addFoodToEntry: (entryId: string, food: Food, quantite: number, unite: Unit) => void;
  updateItem: (entryId: string, itemId: string, patch: Partial<JournalItem>) => void;
  /**
   * Renomme un aliment du journal en texte libre (« pizza » → « pizza 4
   * fromages ») : corrige un nom mal entendu ou trop vague sans avoir à
   * supprimer l'item et tout redicter. Le nom est aussi re-matché contre la
   * banque quand rien n'est encore associé, de sorte que corriger le nom peut
   * suffire à retrouver le bon aliment.
   */
  renameItem: (entryId: string, itemId: string, nom: string) => void;
  /**
   * Ajuste « pour cette fois » les valeurs d'un item : `contribution` = apports
   * réels pour la quantité mangée (ce qui s'affiche dans le bilan). `null` annule
   * l'ajustement et rétablit les valeurs de l'aliment / estimation.
   */
  setItemNutrients: (entryId: string, itemId: string, contribution: Nutrients | null) => void;
  /**
   * Corrige les valeurs de l'aliment associé dans ma banque à partir des
   * apports saisis pour cet item. La correction est ramenée à 100 g et se
   * répercute sur l'historique, sauf les ajustements ponctuels déjà posés.
   * Renvoie false si l'item ne correspond à aucun aliment de la banque.
   */
  setItemNutrientsGlobally: (entryId: string, itemId: string, contribution: Nutrients) => boolean;
  removeItem: (entryId: string, itemId: string) => void;
  addItemToEntry: (entryId: string, item: ExtractedItem) => void;
  removeEntry: (entryId: string) => void;
  /** Déplace une entrée vers un autre jour (saisie faite le lendemain, erreur de date…). */
  moveEntry: (entryId: string, date: string) => void;
  /**
   * Force ou libère le rattachement d'une entrée au repas précédent.
   * `null` revient au regroupement automatique (cf. `JournalEntry.mealLink`).
   */
  setEntryMealLink: (entryId: string, link: 'join' | 'break' | null) => void;
  /** Duplique une entrée (repas passé) vers un autre jour — défaut : aujourd'hui. */
  duplicateEntry: (entryId: string, date?: string) => void;
  /** Duplique toutes les entrées d'un jour vers un autre — défaut : aujourd'hui. */
  duplicateDay: (fromDate: string, toDate?: string) => void;
  /**
   * Renseigne la catégorie des aliments NON résolus du journal, par nom (comparé
   * normalisé) : rattrapage groupé de l'historique saisi avant que la catégorie
   * ne soit conservée. Ne touche jamais un item déjà classé. Renvoie le nombre
   * d'items complétés.
   */
  setItemCategories: (byName: Record<string, FoodCategory>) => number;

  /** Enregistre un repas favori (« petit-déj habituel ») à partir d'items du journal. */
  saveFavoriteMeal: (nom: string, items: FavoriteMealItem[]) => void;
  removeFavoriteMeal: (id: string) => void;
  /** Renomme un repas favori (les anciens portaient la dictée entière comme nom). */
  renameFavoriteMeal: (id: string, nom: string) => void;
  /** Modifie un aliment d'un repas favori (choix, quantité, unité). */
  updateFavoriteMealItem: (favId: string, index: number, patch: Partial<FavoriteMealItem>) => void;
  /** Retire un aliment d'un repas favori. */
  removeFavoriteMealItem: (favId: string, index: number) => void;
  /** Ajoute un aliment à un repas favori existant. */
  addFavoriteMealItem: (favId: string, item: FavoriteMealItem) => void;
  /** Ajoute un repas favori au journal du jour ciblé (défaut aujourd'hui). */
  applyFavoriteMeal: (id: string, date?: string) => string | null;

  addCustomFood: (food: Omit<Food, 'id' | 'custom'>) => void;
  removeCustomFood: (id: string) => void;
  /** Modifie un aliment de ma banque. La correction se répercute sur tout l'historique. */
  editFood: (id: string, patch: FoodPatch) => void;
  /** Rétablit un aliment copié du catalogue à ses valeurs d'origine (nécessite `sourceId`). */
  resetFood: (id: string) => void;
  /**
   * Copie un aliment du catalogue de référence dans ma banque (id conservé).
   * Sans effet s'il y est déjà. Renvoie l'aliment de banque à utiliser.
   */
  adoptCatalogFood: (food: Food) => Food;
  /** Lève le drapeau « à vérifier » d'un aliment estimé par l'IA (valeurs relues). */
  verifyFood: (id: string) => void;
  /**
   * Range des aliments de la banque dans une catégorie (rattrapage groupé par
   * l'IA). Distinct de `editFood` : une catégorie ne change aucun chiffre, donc
   * ni resynchronisation de l'historique ni levée du drapeau « à vérifier » —
   * classer un aliment ne veut pas dire qu'on a relu ses valeurs.
   * Renvoie le nombre d'aliments effectivement déplacés.
   */
  setFoodCategories: (byId: Record<string, FoodCategory>) => number;
  /**
   * Fusionne deux aliments de la banque : `sourceId` disparaît au profit de
   * `targetId`, qui hérite de son nom en alias. Tous les items du journal et des
   * repas favoris qui le référençaient basculent sur la cible et sont recalculés.
   * Renvoie le nombre d'items de journal repointés.
   */
  mergeFoods: (sourceId: string, targetId: string) => number;

  /**
   * Enregistre une pesée. `poids` requis ; les autres champs sont optionnels.
   * `createdAt` : heure de saisie (epoch ms), passée par la synchro pour l'heure
   * d'envoi de l'appareil émetteur ; défaut `Date.now()`.
   */
  addWeightEntry: (entry: Omit<WeightEntry, 'id' | 'createdAt'>, createdAt?: number) => string;
  updateWeightEntry: (id: string, patch: Partial<WeightEntry>) => void;
  removeWeightEntry: (id: string) => void;
  setWeightConfig: (patch: Partial<WeightConfig>) => void;
  addBodyMeasurement: (entry: Omit<BodyMeasurementEntry, 'id' | 'createdAt'>, createdAt?: number) => string;
  updateBodyMeasurement: (id: string, patch: Partial<Omit<BodyMeasurementEntry, 'id' | 'createdAt'>>) => void;
  removeBodyMeasurement: (id: string) => void;

  /**
   * Enregistre une sortie au soleil (section « Soleil » du jour). `createdAt` :
   * heure de saisie (epoch ms), passée par la synchro pour l'heure d'envoi de
   * l'appareil émetteur ; défaut `Date.now()`.
   */
  addSunExposure: (e: Omit<SunExposure, 'id' | 'createdAt'>, createdAt?: number) => string;
  /** Corrige une sortie déjà enregistrée (durée, ciel, peau… après une dictée auto-validée). */
  updateSunExposure: (id: string, patch: Partial<Omit<SunExposure, 'id' | 'createdAt'>>) => void;
  removeSunExposure: (id: string) => void;
  /** Recalcule chaque item lié à la banque, sans changer les saisies libres. */
  resyncHistory: () => number;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      entries: [],
      customFoods: [],
      bankSchemaVersion: BANK_SCHEMA_VERSION,
      sttEngine: isNativeSttSupported() ? 'native' : 'whisper',
      sttModel: DEFAULT_STT_MODEL,
      llmModel: DEFAULT_LLM_MODEL,
      extractionMode: 'rules',
      cloudProvider: DEFAULT_CLOUD_PROVIDER,
      cloudApiKeys: {},
      cloudModels: {},
      cliBridge: 'claude',
      cliModels: {},
      cloudApiKey: '',
      cloudModel: defaultModelFor(DEFAULT_CLOUD_PROVIDER),
      profile: DEFAULT_PROFILE,
      weightEntries: SEED_WEIGHT_ENTRIES,
      bodyMeasurements: [],
      weightConfig: SEED_WEIGHT_CONFIG,
      favoriteMeals: [],
      sunExposures: [],
      deviceId: uid(),
      syncCursor: null,
      lastAutoSave: null,
      mutedDays: {},
      dayNotes: {},
      nutrientImportance: {},
      nutrientTargets: {},

      setSttEngine: (e) => set({ sttEngine: e }),
      setSttModel: (id) => set({ sttModel: id }),
      setLlmModel: (id) => set({ llmModel: id }),
      setExtractionMode: (m) => set({ extractionMode: m }),
      setCloudProvider: (p) => set({ cloudProvider: p }),
      setCloudApiKey: (k) =>
        set((s) => ({ cloudApiKeys: { ...s.cloudApiKeys, [s.cloudProvider]: k } })),
      setCloudModel: (id) =>
        set((s) => ({ cloudModels: { ...s.cloudModels, [s.cloudProvider]: id } })),
      setCliBridge: (c) => set({ cliBridge: c }),
      setCliModel: (cli, id) =>
        set((s) => ({ cliModels: { ...s.cliModels, [cli]: id } })),
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      setSyncCursor: (cursor) => set({ syncCursor: cursor }),
      setLastAutoSave: (day) => set({ lastAutoSave: day }),

      setDayMute: (date, muted) =>
        set((s) => {
          const hasEntries = s.entries.some((e) => e.date === date);
          const next = { ...s.mutedDays };
          // Si l'override rejoint le défaut du jour, on l'efface (map compacte).
          if (muted === !hasEntries) delete next[date];
          else next[date] = muted;
          return { mutedDays: next };
        }),

      toggleDayMute: (date) => {
        const s = get();
        const hasEntries = s.entries.some((e) => e.date === date);
        // Compté actuellement ? → on le mute. Non compté ? → on le compte (jeûne).
        get().setDayMute(date, isDayCounted(s.mutedDays, hasEntries, date));
      },

      setDayNote: (date, note) =>
        set((s) => {
          const trimmed = note.trim();
          const next = { ...s.dayNotes };
          if (trimmed) next[date] = trimmed;
          else delete next[date];
          return { dayNotes: next };
        }),

      setNutrientImportance: (key, value) =>
        set((s) => ({ nutrientImportance: { ...s.nutrientImportance, [key]: value } })),

      resetNutrientImportance: (key) =>
        set((s) => {
          const { [key]: _drop, ...rest } = s.nutrientImportance;
          return { nutrientImportance: rest };
        }),

      resetAllNutrientImportance: () => set({ nutrientImportance: {} }),

      setNutrientTarget: (key, patch) =>
        set((s) => {
          const merged = { ...(s.nutrientTargets[key] ?? {}), ...patch };
          for (const k of Object.keys(merged) as (keyof typeof merged)[]) {
            if (merged[k] === undefined) delete merged[k];
          }
          // Une entrée qui ne garde plus QUE son unité (`perKg`) est conservée :
          // choisir « g/kg » avant de saisir quoi que ce soit est le geste
          // normal, et l'oublier ferait retomber le champ en grammes sous les
          // doigts de l'utilisateur. Elle ne compte pas pour autant comme une
          // cible modifiée (cf. `hasTargetOverride`).
          if (Object.keys(merged).length === 0) {
            const { [key]: _drop, ...rest } = s.nutrientTargets;
            return { nutrientTargets: rest };
          }
          return { nutrientTargets: { ...s.nutrientTargets, [key]: merged } };
        }),

      resetNutrientTarget: (key) =>
        set((s) => {
          const { [key]: _drop, ...rest } = s.nutrientTargets;
          return { nutrientTargets: rest };
        }),

      resetAllNutrientTargets: () => set({ nutrientTargets: {} }),

      addEntry: (transcript, items, source, date, createdAt) => {
        const jour = date ?? todayStr();
        const computed = computeItems(items, get().customFoods, recentFoodCounts(get().entries));
        // Tout aliment hors catalogue estimé par l'IA entre ici dans la banque :
        // c'est le seul point de passage des saisies (dictée, photo, et poller de
        // la file Supabase), donc le seul endroit où le brancher.
        const ingested = ingestEstimates(get().customFoods, computed, jour);
        const entry: JournalEntry = {
          id: uid(),
          date: jour,
          createdAt: createdAt ?? Date.now(),
          transcript,
          source,
          items: ingested.computed.map(toJournalItem),
        };
        set((s) => ({ entries: [entry, ...s.entries], customFoods: ingested.customFoods }));
        return entry.id;
      },

      addFoodEntry: (food, quantite, unite, date) => {
        // Choisi dans le catalogue de référence : il entre dans ma banque du même
        // geste — on ne mange pas un aliment sans qu'il rejoigne la banque.
        const inBank = get().adoptCatalogFood(food);
        const grams = toGrams({ aliment: inBank.nom, quantite, unite, estimation: false }, inBank);
        const item: JournalItem = {
          id: uid(),
          foodId: inBank.id,
          nomAffiche: inBank.nom,
          quantite,
          unite,
          grams,
          nutrients: scaleNutrients(inBank.n, grams),
          estimation: false,
          douteux: false,
        };
        const entry: JournalEntry = {
          id: uid(),
          date: date ?? todayStr(),
          createdAt: Date.now(),
          transcript: '',
          source: 'manuel',
          items: [item],
        };
        set((s) => ({ entries: [entry, ...s.entries] }));
        return entry.id;
      },

      addFoodToEntry: (entryId, food, quantite, unite) =>
        set((s) => {
          const inBank = get().adoptCatalogFood(food);
          const grams = toGrams({ aliment: inBank.nom, quantite, unite, estimation: false }, inBank);
          const item: JournalItem = {
            id: uid(),
            foodId: inBank.id,
            nomAffiche: inBank.nom,
            quantite,
            unite,
            grams,
            nutrients: scaleNutrients(inBank.n, grams),
            estimation: false,
            douteux: false,
          };
          return { entries: s.entries.map((entry) => entry.id === entryId ? { ...entry, items: [...entry.items, item] } : entry) };
        }),

      updateItem: (entryId, itemId, patch) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id !== entryId
              ? e
              : {
                  ...e,
                  items: e.items.map((it) => {
                    if (it.id !== itemId) return it;
                    // Choisir un autre aliment annule l'ajustement « pour cette fois ».
                    const base = patch.foodId !== undefined && patch.foodId !== it.foodId ? { ...it, customN: undefined } : it;
                    // Corriger la quantité rend caduque la fourchette estimée par l'IA.
                    const clearRange =
                      patch.quantite !== undefined && patch.quantite !== it.quantite
                        ? { quantiteMin: undefined, quantiteMax: undefined }
                        : {};
                    return recomputeItem({ ...base, ...patch, ...clearRange }, get().customFoods);
                  }),
                },
          ),
        })),

      renameItem: (entryId, itemId, nom) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id !== entryId
              ? e
              : {
                  ...e,
                  items: e.items.map((it) => {
                    if (it.id !== itemId) return it;
                    const clean = nom.trim();
                    if (!clean || clean === it.nomAffiche) return it;
                    // Un item lié à la banque reprend le nom de son aliment à
                    // chaque recalcul : pour que le nom libre tienne, on fige
                    // ses apports « pour cette fois » (l'aliment reste attaché,
                    // il sert encore à convertir pièces/portions en grammes).
                    // « ↺ Rétablir » ramène donc aussi le nom d'origine.
                    const base =
                      it.foodId && !it.customN && !it.iaEstime
                        ? { ...it, customN: per100g(it.nutrients, it.grams) }
                        : it;
                    return recomputeItem({ ...base, nomAffiche: clean }, get().customFoods);
                  }),
                },
          ),
        })),

      setItemNutrients: (entryId, itemId, contribution) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id !== entryId
              ? e
              : {
                  ...e,
                  items: e.items.map((it) => {
                    if (it.id !== itemId) return it;
                    const foods = get().customFoods;
                    if (!contribution) {
                      const { customN: _drop, ...rest } = it;
                      return recomputeItem(rest, foods);
                    }
                    // On mémorise l'ajustement en « pour 100 g » (rescalable si la
                    // quantité change), converti depuis l'apport réel saisi.
                    return recomputeItem({ ...it, customN: per100g(contribution, it.grams) }, foods);
                  }),
                },
          ),
        })),

      setItemNutrientsGlobally: (entryId, itemId, contribution) => {
        const s = get();
        const item = s.entries.find((e) => e.id === entryId)?.items.find((it) => it.id === itemId);
        const food = item?.foodId ? effectiveFoodById(item.foodId, s.customFoods) : null;
        if (!item || !food) return false;

        const n = per100g(contribution, item.grams);
        const existing = s.customFoods.find((f) => f.id === food.id);
        // Un aliment encore seulement dans le catalogue est d'abord copié dans
        // ma banque : la correction devient personnelle, sans toucher au
        // catalogue livré avec l'application.
        const corrected = { ...(existing ?? adoptFromCatalog(food, todayStr())), n, aVerifier: undefined };
        const customFoods = existing
          ? s.customFoods.map((f) => (f.id === food.id ? corrected : f))
          : [corrected, ...s.customFoods];
        const entries = s.entries.map((e) =>
          e.id !== entryId
            ? e
            : {
                ...e,
                items: e.items.map((it) => {
                  if (it.id !== itemId) return it;
                  const { customN: _drop, ...rest } = it;
                  return rest;
                }),
              },
        );
        set({ customFoods, entries: resyncEntries(entries, customFoods) });
        return true;
      },

      removeItem: (entryId, itemId) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id !== entryId ? e : { ...e, items: e.items.filter((it) => it.id !== itemId) },
          ),
        })),

      addItemToEntry: (entryId, item) =>
        set((s) => ({
          entries: s.entries.map((e) => {
            if (e.id !== entryId) return e;
            const [ci] = computeItems([item], get().customFoods);
            return { ...e, items: [...e.items, toJournalItem(ci)] };
          }),
        })),

      removeEntry: (entryId) => set((s) => ({ entries: s.entries.filter((e) => e.id !== entryId) })),

      moveEntry: (entryId, date) =>
        set((s) => ({ entries: s.entries.map((e) => (e.id === entryId ? { ...e, date } : e)) })),

      setEntryMealLink: (entryId, link) =>
        set((s) => ({
          entries: s.entries.map((e) => {
            if (e.id !== entryId) return e;
            // Retour à l'automatique : on RETIRE le champ au lieu de le mettre à
            // undefined, pour qu'une entrée jamais corrigée et une entrée remise
            // en automatique soient rigoureusement le même objet (JSON, synchro).
            const { mealLink: _drop, ...rest } = e;
            return link ? { ...rest, mealLink: link } : rest;
          }),
        })),

      duplicateEntry: (entryId, date) =>
        set((s) => {
          const src = s.entries.find((e) => e.id === entryId);
          if (!src) return {};
          const copy: JournalEntry = {
            ...src,
            id: uid(),
            date: date ?? todayStr(),
            createdAt: Date.now(),
            transcript: copiedTranscript(src.transcript),
            items: src.items.map((it) => ({ ...it, id: uid() })),
          };
          return { entries: [copy, ...s.entries] };
        }),

      duplicateDay: (fromDate, toDate) =>
        set((s) => {
          const target = toDate ?? todayStr();
          const copies: JournalEntry[] = s.entries
            .filter((e) => e.date === fromDate)
            .map((e) => ({
              ...e,
              id: uid(),
              date: target,
              createdAt: Date.now(),
              transcript: copiedTranscript(e.transcript),
              items: e.items.map((it) => ({ ...it, id: uid() })),
            }));
          return copies.length > 0 ? { entries: [...copies, ...s.entries] } : {};
        }),

      setItemCategories: (byName) => {
        const wanted = new Map(Object.entries(byName).map(([nom, c]) => [normalizeForMatch(nom), c]));
        let count = 0;
        const entries = get().entries.map((e) => {
          let touched = false;
          const items = e.items.map((it) => {
            if (it.foodId || it.categorie) return it;
            const c = wanted.get(normalizeForMatch(it.nomAffiche));
            if (!c) return it;
            touched = true;
            count++;
            return { ...it, categorie: c };
          });
          return touched ? { ...e, items } : e;
        });
        if (count > 0) set({ entries });
        return count;
      },

      saveFavoriteMeal: (nom, items) =>
        set((s) => ({
          favoriteMeals: [
            {
              id: uid(),
              nom: nom.trim(),
              items: items.map((it) => ({
                foodId: it.foodId,
                nomAffiche: it.nomAffiche,
                quantite: it.quantite,
                unite: it.unite,
                estimation: it.estimation,
              })),
            },
            ...s.favoriteMeals,
          ],
        })),

      removeFavoriteMeal: (id) =>
        set((s) => ({ favoriteMeals: s.favoriteMeals.filter((f) => f.id !== id) })),

      renameFavoriteMeal: (id, nom) =>
        set((s) => {
          const trimmed = nom.trim();
          if (!trimmed) return {};
          return { favoriteMeals: s.favoriteMeals.map((f) => (f.id === id ? { ...f, nom: trimmed } : f)) };
        }),

      updateFavoriteMealItem: (favId, index, patch) =>
        set((s) => ({
          favoriteMeals: s.favoriteMeals.map((f) =>
            f.id === favId ? { ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : f,
          ),
        })),

      removeFavoriteMealItem: (favId, index) =>
        set((s) => ({
          favoriteMeals: s.favoriteMeals.map((f) =>
            f.id === favId ? { ...f, items: f.items.filter((_, i) => i !== index) } : f,
          ),
        })),

      addFavoriteMealItem: (favId, item) =>
        set((s) => ({
          favoriteMeals: s.favoriteMeals.map((f) => (f.id === favId ? { ...f, items: [...f.items, item] } : f)),
        })),

      applyFavoriteMeal: (id, date) => {
        const fav = get().favoriteMeals.find((f) => f.id === id);
        if (!fav || fav.items.length === 0) return null;
        const foods = get().customFoods;
        // Re-résolution à l'application : les valeurs nutritionnelles restent à jour
        // même si l'aliment a été modifié depuis l'enregistrement du favori.
        const items: JournalItem[] = fav.items.map((fi) => {
          const food = fi.foodId ? foods.find((f) => f.id === fi.foodId) ?? null : null;
          if (food) {
            const grams = toGrams({ aliment: food.nom, quantite: fi.quantite, unite: fi.unite, estimation: fi.estimation }, food);
            return {
              id: uid(),
              foodId: food.id,
              nomAffiche: food.nom,
              quantite: fi.quantite,
              unite: fi.unite,
              grams,
              nutrients: scaleNutrients(food.n, grams),
              estimation: fi.estimation,
              douteux: false,
            };
          }
          const [ci] = computeItems(
            [{ aliment: fi.nomAffiche, quantite: fi.quantite, unite: fi.unite, estimation: fi.estimation }],
            foods,
          );
          return toJournalItem(ci);
        });
        const entry: JournalEntry = {
          id: uid(),
          date: date ?? todayStr(),
          createdAt: Date.now(),
          transcript: `⭐ ${fav.nom}`,
          source: 'manuel',
          items,
        };
        set((s) => ({ entries: [entry, ...s.entries] }));
        return entry.id;
      },

      addCustomFood: (food) =>
        set((s) => ({
          customFoods: [
            { ...food, id: `custom-${uid()}`, custom: true, origine: 'manuel', ajouteLe: todayStr() },
            ...s.customFoods,
          ],
        })),

      removeCustomFood: (id) => set((s) => ({ customFoods: s.customFoods.filter((f) => f.id !== id) })),

      editFood: (id, patch) =>
        set((s) => {
          const customFoods = s.customFoods.map((f) =>
            f.id === id
              ? {
                  ...f,
                  ...patch,
                  id,
                  n: { ...f.n, ...(patch.n ?? {}) },
                  // Relire et corriger un aliment, c'est le vérifier.
                  aVerifier: undefined,
                }
              : f,
          );
          // Répercute immédiatement la correction sur tout l'historique déjà saisi
          // (mêmes items, nutriments recalculés depuis l'aliment mis à jour).
          return { customFoods, entries: resyncEntries(s.entries, customFoods) };
        }),

      resetFood: (id) =>
        set((s) => {
          const current = s.customFoods.find((f) => f.id === id);
          const source = current?.sourceId ? FOOD_BY_ID.get(current.sourceId) : undefined;
          if (!current || !source) return {};
          const customFoods = s.customFoods.map((f) =>
            f.id === id ? { ...adoptFromCatalog(source, current.ajouteLe), aliases: source.aliases } : f,
          );
          return { customFoods, entries: resyncEntries(s.entries, customFoods) };
        }),

      adoptCatalogFood: (food) => {
        const existing = get().customFoods.find((f) => f.id === food.id);
        if (existing) return existing;
        // Un aliment du catalogue peut porter le même nom qu'un aliment déjà en
        // banque (perso saisi à la main) : on réutilise celui-ci plutôt que d'en
        // créer un jumeau que l'utilisateur aurait à fusionner ensuite.
        const sameName = findBankFood(get().customFoods, food.nom);
        if (sameName) return sameName;
        const adopted = adoptFromCatalog(food, todayStr());
        set((s) => ({ customFoods: [adopted, ...s.customFoods] }));
        return adopted;
      },

      verifyFood: (id) =>
        set((s) => ({
          customFoods: s.customFoods.map((f) => (f.id === id ? { ...f, aVerifier: undefined } : f)),
        })),

      setFoodCategories: (byId) => {
        let n = 0;
        set((s) => ({
          customFoods: s.customFoods.map((f) => {
            const c = byId[f.id];
            if (!c || c === f.categorie) return f;
            n++;
            return { ...f, categorie: c };
          }),
        }));
        return n;
      },

      mergeFoods: (sourceId, targetId) => {
        const s = get();
        const r = mergeBankFoods(s.customFoods, s.entries, s.favoriteMeals, sourceId, targetId);
        if (r.itemsRepointes === 0 && r.customFoods.length === s.customFoods.length) return 0;
        set({
          customFoods: r.customFoods,
          // Les items repointés doivent adopter les valeurs de la cible.
          entries: resyncEntries(r.entries, r.customFoods),
          favoriteMeals: r.favoriteMeals,
        });
        return r.itemsRepointes;
      },

      addWeightEntry: (entry, createdAt) => {
        const full: WeightEntry = { ...entry, id: uid(), createdAt: createdAt ?? Date.now() };
        set((s) => {
          const weightEntries = [full, ...s.weightEntries];
          const latest = latestWeight(weightEntries);
          return {
            weightEntries,
            profile: latest != null ? { ...s.profile, poids: latest } : s.profile,
          };
        });
        return full.id;
      },

      updateWeightEntry: (id, patch) =>
        set((s) => {
          const weightEntries = s.weightEntries.map((e) => (e.id === id ? { ...e, ...patch } : e));
          const latest = latestWeight(weightEntries);
          return {
            weightEntries,
            profile: latest != null ? { ...s.profile, poids: latest } : s.profile,
          };
        }),

      removeWeightEntry: (id) =>
        set((s) => ({ weightEntries: s.weightEntries.filter((e) => e.id !== id) })),

      setWeightConfig: (patch) => set((s) => ({ weightConfig: { ...s.weightConfig, ...patch } })),

      addBodyMeasurement: (entry, createdAt) => {
        const full: BodyMeasurementEntry = { ...entry, id: uid(), createdAt: createdAt ?? Date.now() };
        set((s) => ({ bodyMeasurements: [full, ...s.bodyMeasurements] }));
        return full.id;
      },

      updateBodyMeasurement: (id, patch) =>
        set((s) => ({ bodyMeasurements: s.bodyMeasurements.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) })),

      removeBodyMeasurement: (id) =>
        set((s) => ({ bodyMeasurements: s.bodyMeasurements.filter((entry) => entry.id !== id) })),

      addSunExposure: (e, createdAt) => {
        const id = uid();
        set((s) => ({ sunExposures: [{ ...e, id, createdAt: createdAt ?? Date.now() }, ...s.sunExposures] }));
        return id;
      },

      updateSunExposure: (id, patch) =>
        set((s) => ({
          sunExposures: s.sunExposures.map((e) =>
            e.id === id ? { ...e, ...patch, ...(patch.creme ? { creme: normalizeCreme(patch.creme) } : {}) } : e,
          ),
        })),

      removeSunExposure: (id) =>
        set((s) => ({ sunExposures: s.sunExposures.filter((e) => e.id !== id) })),

      resyncHistory: () => {
        const s = get();
        set({ entries: resyncEntries(s.entries, s.customFoods) });
        return s.entries.length;
      },
    }),
    { name: 'foodrecorder-v1', merge: mergePersisted },
  ),
);

/**
 * Nutriments À JOUR d'un item : recalculés depuis l'aliment de la base (foodId)
 * quand il est résolu et sans ajustement manuel — ainsi TOUTE correction de la
 * base (nouveau nutriment ajouté, valeur corrigée, aliment édité…) se répercute
 * automatiquement sur l'historique déjà saisi. Sinon (aliment supprimé/absent
 * de la base, estimation IA, ajustement « pour cette fois ») on garde le
 * snapshot figé, seulement complété des clés manquantes.
 */
export function resolveItemNutrients(
  it: Pick<JournalItem, 'grams' | 'customN'> & { nutrients: Partial<Nutrients> | undefined },
  food: Food | null,
): Nutrients {
  if (food && !it.customN && it.grams > 0) return scaleNutrients(food.n, it.grams);
  return normalizeNutrients(it.nutrients);
}

/**
 * Recalcule les nutriments de tous les items résolus d'un journal, depuis `foods`.
 *
 * Un foodId absent de la banque retombe sur le CATALOGUE plutôt que sur le
 * snapshot figé de l'item : c'est le cas d'un aliment retiré de la banque, ou
 * d'une entrée reçue en synchro avant l'aliment qu'elle référence. Les vraies
 * valeurs valent mieux qu'une photo prise on ne sait quand.
 */
export function resyncEntries(entries: JournalEntry[], foods: Food[]): JournalEntry[] {
  // Index monté une fois : sans lui, on refait un scan linéaire de la banque
  // pour chaque item de tout l'historique, à chaque hydratation.
  const byId = new Map(foods.map((f) => [f.id, f]));
  return entries.map((e) => ({
    ...e,
    items: e.items.map((it) => ({
      ...it,
      nutrients: resolveItemNutrients(it, it.foodId ? byId.get(it.foodId) ?? FOOD_BY_ID.get(it.foodId) ?? null : null),
      ...(it.customN ? { customN: normalizeNutrients(it.customN) } : {}),
      // L'estimation IA « pour 100 g » est rescalée à chaque édition de quantité :
      // elle doit être complétée elle aussi, sinon la correction se reperdrait.
      ...(it.iaEstime ? { iaEstime: { ...it.iaEstime, n: normalizeNutrients(it.iaEstime.n) } } : {}),
    })),
  }));
}

/**
 * Fusion à l'hydratation : réconcilie l'état persisté avec l'état courant et
 * recalcule les nutriments figés (entrées + aliments custom) depuis la base
 * ACTUELLE — toute évolution de foods.ts (nouveaux nutriments, valeurs
 * corrigées) se répercute ainsi sur tout l'historique dès le prochain chargement.
 */
function mergePersisted(persisted: unknown, current: AppState): AppState {
  // `foodOverrides` est retiré de l'état courant : on ne le lit que pour migrer,
  // et il ne doit pas être re-persisté par le spread de `p` plus bas.
  const { foodOverrides, ...p } = (persisted ?? {}) as Partial<AppState> & { foodOverrides?: FoodOverrides };
  const favoriteMeals = p.favoriteMeals ?? [];
  const stored = (p.customFoods ?? []).map((food) => ({ ...food, n: normalizeNutrients(food.n) }));

  // Migration unique vers la banque personnelle : les aliments du catalogue
  // réellement mangés y sont copiés (id conservé), et les estimations IA jusqu'ici
  // enfermées dans les items deviennent de vrais aliments. Idempotente, mais on la
  // garde derrière un numéro de version pour ne pas la rejouer à chaque démarrage.
  const migrated =
    (p.bankSchemaVersion ?? 1) >= BANK_SCHEMA_VERSION
      ? { customFoods: stored, entries: p.entries ?? [] }
      : migrateToPersonalBank({
          entries: p.entries ?? [],
          customFoods: stored,
          foodOverrides: foodOverrides ?? {},
          favoriteMeals,
        });

  const customFoods = migrated.customFoods;
  const entries = resyncEntries(migrated.entries, customFoods);
  return {
    ...current,
    ...p,
    entries,
    customFoods,
    bankSchemaVersion: BANK_SCHEMA_VERSION,
    favoriteMeals,
    // Migration : ancien champ `creme` booléen → enum ('aucune' | 'visage' | 'complete').
    sunExposures: (p.sunExposures ?? []).map((e) => ({ ...e, creme: normalizeCreme(e.creme) })),
    // Le seed de pesées ne s'applique qu'à la 1re utilisation (clé absente du persisté).
    weightEntries: p.weightEntries ?? current.weightEntries,
    bodyMeasurements: p.bodyMeasurements ?? [],
    weightConfig: { ...current.weightConfig, ...(p.weightConfig ?? {}) },
    // Reprise de l'ancien réglage mono-fournisseur : la clé et le modèle
    // Anthropic déjà saisis deviennent le casier « anthropic ». Recopie, pas
    // déplacement — `cloudApiKey`/`cloudModel` restent en place (cf. AppState).
    cloudApiKeys: p.cloudApiKeys ?? (p.cloudApiKey ? { anthropic: p.cloudApiKey } : {}),
    cloudModels: p.cloudModels ?? (p.cloudModel ? { anthropic: p.cloudModel } : {}),
    // Réglage additif : les anciennes sauvegardes continuent avec le modèle
    // par défaut de chaque CLI, sans migration des données nutritionnelles.
    cliModels: p.cliModels ?? {},
    mutedDays: p.mutedDays ?? {},
    dayNotes: p.dayNotes ?? {},
    nutrientImportance: p.nutrientImportance ?? {},
    nutrientTargets: p.nutrientTargets ?? {},
  };
}

/** Convertit un apport réel (pour `grams` g) en valeurs pour 100 g. */
function per100g(contribution: Nutrients, grams: number): Nutrients {
  const factor = grams > 0 ? 100 / grams : 1;
  const out = { ...EMPTY_NUTRIENTS };
  for (const k of Object.keys(out) as (keyof Nutrients)[]) out[k] = (contribution[k] ?? 0) * factor;
  return out;
}

/** Recalcule grams + nutriments d'un item quand foodId/quantité/unité changent. */
function recomputeItem(item: JournalItem, foods: Food[]): JournalItem {
  // Si un aliment est explicitement associé, on l'utilise directement (pas de re-matching).
  const food: Food | null = item.foodId ? foods.find((f) => f.id === item.foodId) ?? null : null;

  // Ajustement « pour cette fois » : les valeurs de l'item priment. On garde
  // l'aliment/estimation associés uniquement pour convertir l'unité en grammes.
  if (item.customN) {
    const foodForGrams: Food | null =
      food ??
      (item.iaEstime
        ? { id: 'ia-estime', nom: item.nomAffiche, categorie: 'autre', aliases: [], pieceGrams: item.iaEstime.pieceGrams, n: item.iaEstime.n }
        : null);
    const grams = toGrams(
      { aliment: item.nomAffiche, quantite: item.quantite, unite: item.unite, estimation: item.estimation },
      foodForGrams,
    );
    return { ...item, grams, nutrients: scaleNutrients(item.customN, grams), douteux: false };
  }

  if (food) {
    const grams = toGrams({ aliment: food.nom, quantite: item.quantite, unite: item.unite, estimation: item.estimation }, food);
    // Choisir un aliment de la base annule l'estimation IA (valeurs de la base désormais fiables).
    return { ...item, nomAffiche: food.nom, grams, nutrients: scaleNutrients(food.n, grams), douteux: false, iaEstime: undefined };
  }

  // Aliment estimé par l'IA (hors base, non associé) : on rescale l'estimation conservée.
  if (item.iaEstime) {
    const grams = toGrams(
      { aliment: item.nomAffiche, quantite: item.quantite, unite: item.unite, estimation: item.estimation },
      { id: 'ia-estime', nom: item.nomAffiche, categorie: 'autre', aliases: [], pieceGrams: item.iaEstime.pieceGrams, n: item.iaEstime.n },
    );
    return { ...item, grams, nutrients: scaleNutrients(item.iaEstime.n, grams), douteux: false };
  }

  // Aliment non résolu : on re-matche le texte affiché.
  const [ci] = computeItems(
    [{ aliment: item.nomAffiche, quantite: item.quantite, unite: item.unite, estimation: item.estimation }],
    foods,
  );
  return {
    ...item,
    foodId: ci.match.food?.id ?? null,
    nomAffiche: ci.match.food?.nom ?? item.nomAffiche,
    grams: ci.grams,
    nutrients: ci.nutrients ?? item.nutrients,
    douteux: ci.match.douteux || ci.match.food === null,
  };
}

/**
 * Un jour est-il COMPTÉ dans les moyennes/stats ? Un override explicite prime
 * (`mutedDays[date]` : true = muté/exclu, false = jeûne forcé compté) ; sinon le
 * défaut est : jour rempli → compté, jour vide → non compté (probable non-remplissage).
 */
export function isDayCounted(mutedDays: Record<string, boolean>, hasEntries: boolean, date: string): boolean {
  const ov = mutedDays[date];
  if (ov !== undefined) return !ov;
  return hasEntries;
}

/** Totaux d'une journée donnée. */
export function dayTotals(entries: JournalEntry[], date: string): Nutrients {
  const items: ComputedItem[] = entries
    .filter((e) => e.date === date)
    .flatMap((e) => e.items.map((it) => ({ extracted: { aliment: it.nomAffiche, quantite: it.quantite, unite: it.unite, estimation: it.estimation }, match: { food: null, score: 1, douteux: false, alternatives: [] }, grams: it.grams, nutrients: it.nutrients })));
  return totalNutrients(items);
}

export { todayStr, nowTime };
