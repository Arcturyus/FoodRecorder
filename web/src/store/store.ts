import { useMemo } from 'react';
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
import { computeItems, totalNutrients, toGrams, scaleNutrients } from '../nutrition/compute';
import { FOODS, FOOD_BY_ID, splitSaturated } from '../nutrition/foods';
import { DEFAULT_LLM_MODEL } from '../extraction/llm';
import { DEFAULT_CLOUD_MODEL } from '../extraction/anthropic';
import { DEFAULT_STT_MODEL } from '../stt/whisper';
import { isNativeSttSupported } from '../stt/webspeech';
import { normalizeForMatch } from '../nutrition/normalize';
import { isPhotoEntry } from '../nutrition/uncertainty';
import { DEFAULT_PROFILE } from '../nutrition/targets';
import type { Profile } from '../nutrition/targets';
import type { WeightEntry, WeightConfig } from '../weight/types';
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
  source: 'llm' | 'anthropic' | 'claudecode' | 'rules' | 'manuel';
  items: JournalItem[];
}

/** Choix du moteur d'extraction. */
export type ExtractionMode = 'rules' | 'local' | 'cloud' | 'claudecode';

/** Choix du moteur de transcription vocale. */
export type SttEngine = 'whisper' | 'native';

/** Patch d'aliment : champs optionnels + nutriments partiels (fusionnés à l'application). */
export type FoodPatch = Partial<Omit<Food, 'n'>> & { n?: Partial<Nutrients> };
/** Modifications utilisateur sur les aliments de la banque (par id d'aliment). */
export type FoodOverrides = Record<string, FoodPatch>;

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

/** Applique un override utilisateur sur un aliment (fusionne aussi les nutriments). */
function applyOverride(food: Food, ov?: FoodPatch): Food {
  if (!ov) return food;
  return { ...food, ...ov, id: food.id, n: { ...food.n, ...(ov.n ?? {}) } };
}

/**
 * Liste des aliments « effectifs » = aliments personnalisés + banque avec les
 * modifications utilisateur (overrides) appliquées. C'est cette liste qui sert
 * au matching, aux calculs et à l'affichage (banque comme perso sont éditables).
 */
export function effectiveFoods(customFoods: Food[], overrides: FoodOverrides): Food[] {
  const bank = FOODS.map((f) => applyOverride(f, overrides[f.id]));
  return [...customFoods, ...bank];
}

/** Résout un aliment (perso ou banque avec override) par son id. */
export function effectiveFoodById(id: string, customFoods: Food[], overrides: FoodOverrides): Food | null {
  const custom = customFoods.find((f) => f.id === id);
  if (custom) return custom;
  const bank = FOOD_BY_ID.get(id);
  return bank ? applyOverride(bank, overrides[id]) : null;
}

/** Hook : liste des aliments effectifs, mémoïsée sur (customFoods, foodOverrides). */
export function useEffectiveFoods(): Food[] {
  const customFoods = useStore((s) => s.customFoods);
  const overrides = useStore((s) => s.foodOverrides);
  return useMemo(() => effectiveFoods(customFoods, overrides), [customFoods, overrides]);
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
  customFoods: Food[];
  foodOverrides: FoodOverrides;
  sttEngine: SttEngine;
  sttModel: string;
  llmModel: string;
  extractionMode: ExtractionMode;
  cloudApiKey: string;
  cloudModel: string;
  profile: Profile;
  weightEntries: WeightEntry[];
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

  setSttEngine: (e: SttEngine) => void;
  setSttModel: (id: string) => void;
  setLlmModel: (id: string) => void;
  setExtractionMode: (m: ExtractionMode) => void;
  setCloudApiKey: (k: string) => void;
  setCloudModel: (id: string) => void;
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
  removeItem: (entryId: string, itemId: string) => void;
  addItemToEntry: (entryId: string, item: ExtractedItem) => void;
  removeEntry: (entryId: string) => void;
  /** Déplace une entrée vers un autre jour (saisie faite le lendemain, erreur de date…). */
  moveEntry: (entryId: string, date: string) => void;
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
  /** Modifie un aliment (perso → édité directement ; banque → override persistant). */
  editFood: (id: string, patch: FoodPatch) => void;
  /** Annule les modifications utilisateur sur un aliment de la banque. */
  resetFood: (id: string) => void;

  /**
   * Enregistre une pesée. `poids` requis ; les autres champs sont optionnels.
   * `createdAt` : heure de saisie (epoch ms), passée par la synchro pour l'heure
   * d'envoi de l'appareil émetteur ; défaut `Date.now()`.
   */
  addWeightEntry: (entry: Omit<WeightEntry, 'id' | 'createdAt'>, createdAt?: number) => string;
  updateWeightEntry: (id: string, patch: Partial<WeightEntry>) => void;
  removeWeightEntry: (id: string) => void;
  setWeightConfig: (patch: Partial<WeightConfig>) => void;

  /**
   * Enregistre une sortie au soleil (section « Soleil » du jour). `createdAt` :
   * heure de saisie (epoch ms), passée par la synchro pour l'heure d'envoi de
   * l'appareil émetteur ; défaut `Date.now()`.
   */
  addSunExposure: (e: Omit<SunExposure, 'id' | 'createdAt'>, createdAt?: number) => void;
  /** Corrige une sortie déjà enregistrée (durée, ciel, peau… après une dictée auto-validée). */
  updateSunExposure: (id: string, patch: Partial<Omit<SunExposure, 'id' | 'createdAt'>>) => void;
  removeSunExposure: (id: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      entries: [],
      customFoods: [],
      foodOverrides: {},
      sttEngine: isNativeSttSupported() ? 'native' : 'whisper',
      sttModel: DEFAULT_STT_MODEL,
      llmModel: DEFAULT_LLM_MODEL,
      extractionMode: 'rules',
      cloudApiKey: '',
      cloudModel: DEFAULT_CLOUD_MODEL,
      profile: DEFAULT_PROFILE,
      weightEntries: SEED_WEIGHT_ENTRIES,
      weightConfig: SEED_WEIGHT_CONFIG,
      favoriteMeals: [],
      sunExposures: [],
      deviceId: uid(),
      syncCursor: null,
      lastAutoSave: null,
      mutedDays: {},
      dayNotes: {},
      nutrientImportance: {},

      setSttEngine: (e) => set({ sttEngine: e }),
      setSttModel: (id) => set({ sttModel: id }),
      setLlmModel: (id) => set({ llmModel: id }),
      setExtractionMode: (m) => set({ extractionMode: m }),
      setCloudApiKey: (k) => set({ cloudApiKey: k }),
      setCloudModel: (id) => set({ cloudModel: id }),
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

      addEntry: (transcript, items, source, date, createdAt) => {
        const computed = computeItems(
          items,
          effectiveFoods(get().customFoods, get().foodOverrides),
          recentFoodCounts(get().entries),
        );
        const entry: JournalEntry = {
          id: uid(),
          date: date ?? todayStr(),
          createdAt: createdAt ?? Date.now(),
          transcript,
          source,
          items: computed.map(toJournalItem),
        };
        set((s) => ({ entries: [entry, ...s.entries] }));
        return entry.id;
      },

      addFoodEntry: (food, quantite, unite, date) => {
        const grams = toGrams({ aliment: food.nom, quantite, unite, estimation: false }, food);
        const item: JournalItem = {
          id: uid(),
          foodId: food.id,
          nomAffiche: food.nom,
          quantite,
          unite,
          grams,
          nutrients: scaleNutrients(food.n, grams),
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
                    return recomputeItem({ ...base, ...patch, ...clearRange }, effectiveFoods(get().customFoods, get().foodOverrides));
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
                    return recomputeItem({ ...base, nomAffiche: clean }, effectiveFoods(get().customFoods, get().foodOverrides));
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
                    const foods = effectiveFoods(get().customFoods, get().foodOverrides);
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
            const [ci] = computeItems([item], effectiveFoods(get().customFoods, get().foodOverrides));
            return { ...e, items: [...e.items, toJournalItem(ci)] };
          }),
        })),

      removeEntry: (entryId) => set((s) => ({ entries: s.entries.filter((e) => e.id !== entryId) })),

      moveEntry: (entryId, date) =>
        set((s) => ({ entries: s.entries.map((e) => (e.id === entryId ? { ...e, date } : e)) })),

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
        const foods = effectiveFoods(get().customFoods, get().foodOverrides);
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
        set((s) => ({ customFoods: [{ ...food, id: `custom-${uid()}`, custom: true }, ...s.customFoods] })),

      removeCustomFood: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.foodOverrides;
          return { customFoods: s.customFoods.filter((f) => f.id !== id), foodOverrides: rest };
        }),

      editFood: (id, patch) =>
        set((s) => {
          // Aliment perso : on édite l'objet directement (fusion des nutriments).
          const customFoods = id.startsWith('custom-')
            ? s.customFoods.map((f) => (f.id === id ? { ...f, ...patch, id, n: { ...f.n, ...(patch.n ?? {}) } } : f))
            : s.customFoods;
          // Aliment de la banque : override cumulatif persistant.
          const prev = s.foodOverrides[id];
          const foodOverrides = id.startsWith('custom-')
            ? s.foodOverrides
            : { ...s.foodOverrides, [id]: { ...prev, ...patch, n: { ...(prev?.n ?? {}), ...(patch.n ?? {}) } } };
          // Répercute immédiatement la correction sur tout l'historique déjà saisi
          // (mêmes items, nutriments recalculés depuis l'aliment mis à jour).
          return { customFoods, foodOverrides, entries: resyncEntries(s.entries, effectiveFoods(customFoods, foodOverrides)) };
        }),

      resetFood: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.foodOverrides;
          return { foodOverrides: rest, entries: resyncEntries(s.entries, effectiveFoods(s.customFoods, rest)) };
        }),

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

      addSunExposure: (e, createdAt) =>
        set((s) => ({ sunExposures: [{ ...e, id: uid(), createdAt: createdAt ?? Date.now() }, ...s.sunExposures] })),

      updateSunExposure: (id, patch) =>
        set((s) => ({
          sunExposures: s.sunExposures.map((e) =>
            e.id === id ? { ...e, ...patch, ...(patch.creme ? { creme: normalizeCreme(patch.creme) } : {}) } : e,
          ),
        })),

      removeSunExposure: (id) =>
        set((s) => ({ sunExposures: s.sunExposures.filter((e) => e.id !== id) })),
    }),
    { name: 'foodrecorder-v1', merge: mergePersisted },
  ),
);

/**
 * Complète un objet nutriments persisté avec les clés manquantes (nouveaux
 * nutriments).
 *
 * Cas de la répartition des AG saturés, ajoutée après coup : les items résolus
 * à un aliment de la banque se recalculent tout seuls (cf. resolveItemNutrients),
 * mais les estimations IA et les ajustements « pour cette fois » gardent un
 * snapshot figé — sans rattrapage, la moitié de l'historique compterait 0 g de
 * C16+C14 et sortirait du plafond qui compte. On répartit alors le total selon
 * le profil générique « autre » : la catégorie de l'aliment n'est pas conservée
 * dans le journal, et une estimation grossière vaut mieux qu'un trou.
 */
export function normalizeNutrients(n: Partial<Nutrients> | undefined): Nutrients {
  const out = { ...EMPTY_NUTRIENTS, ...(n ?? {}) };
  if (out.agSatures > 0 && out.agSaturesLdl === 0 && out.agSaturesStearique === 0) {
    Object.assign(out, splitSaturated(out.agSatures, 'autre'));
  }
  return out;
}

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

/** Recalcule les nutriments de tous les items résolus d'un journal, depuis `foods`. */
export function resyncEntries(entries: JournalEntry[], foods: Food[]): JournalEntry[] {
  return entries.map((e) => ({
    ...e,
    items: e.items.map((it) => ({
      ...it,
      nutrients: resolveItemNutrients(it, it.foodId ? foods.find((f) => f.id === it.foodId) ?? null : null),
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
  const p = (persisted ?? {}) as Partial<AppState>;
  const customFoods = (p.customFoods ?? []).map((food) => ({ ...food, n: normalizeNutrients(food.n) }));
  const overrides = p.foodOverrides ?? {};
  const entries = resyncEntries(p.entries ?? [], effectiveFoods(customFoods, overrides));
  return {
    ...current,
    ...p,
    entries,
    customFoods,
    foodOverrides: p.foodOverrides ?? {},
    favoriteMeals: p.favoriteMeals ?? [],
    // Migration : ancien champ `creme` booléen → enum ('aucune' | 'visage' | 'complete').
    sunExposures: (p.sunExposures ?? []).map((e) => ({ ...e, creme: normalizeCreme(e.creme) })),
    // Le seed de pesées ne s'applique qu'à la 1re utilisation (clé absente du persisté).
    weightEntries: p.weightEntries ?? current.weightEntries,
    weightConfig: { ...current.weightConfig, ...(p.weightConfig ?? {}) },
    mutedDays: p.mutedDays ?? {},
    dayNotes: p.dayNotes ?? {},
    nutrientImportance: p.nutrientImportance ?? {},
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
