import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ComputedItem, ExtractedItem, Food, Nutrients, Unit } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { computeItems, totalNutrients, toGrams, scaleNutrients } from '../nutrition/compute';
import { FOODS, FOOD_BY_ID } from '../nutrition/foods';
import { DEFAULT_LLM_MODEL } from '../extraction/llm';
import { DEFAULT_CLOUD_MODEL } from '../extraction/anthropic';
import { DEFAULT_STT_MODEL } from '../stt/whisper';
import { isNativeSttSupported } from '../stt/webspeech';
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

  setSttEngine: (e: SttEngine) => void;
  setSttModel: (id: string) => void;
  setLlmModel: (id: string) => void;
  setExtractionMode: (m: ExtractionMode) => void;
  setCloudApiKey: (k: string) => void;
  setCloudModel: (id: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  setSyncCursor: (cursor: string) => void;

  /** Enregistre automatiquement une entrée (auto-validation, plan §Phase 4). */
  /** Ajoute un repas extrait (voix/texte/photo). `date` : jour ciblé (défaut aujourd'hui). */
  addEntry: (transcript: string, items: ExtractedItem[], source: JournalEntry['source'], date?: string) => string;
  /** Ajout manuel d'un aliment choisi explicitement (pas de matching flou). `date` : jour ciblé (défaut aujourd'hui). */
  addFoodEntry: (food: Food, quantite: number, unite: Unit, date?: string) => string;
  updateItem: (entryId: string, itemId: string, patch: Partial<JournalItem>) => void;
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

  /** Enregistre un repas favori (« petit-déj habituel ») à partir d'items du journal. */
  saveFavoriteMeal: (nom: string, items: FavoriteMealItem[]) => void;
  removeFavoriteMeal: (id: string) => void;
  /** Ajoute un repas favori au journal du jour ciblé (défaut aujourd'hui). */
  applyFavoriteMeal: (id: string, date?: string) => string | null;

  addCustomFood: (food: Omit<Food, 'id' | 'custom'>) => void;
  removeCustomFood: (id: string) => void;
  /** Modifie un aliment (perso → édité directement ; banque → override persistant). */
  editFood: (id: string, patch: FoodPatch) => void;
  /** Annule les modifications utilisateur sur un aliment de la banque. */
  resetFood: (id: string) => void;

  /** Enregistre une pesée. `poids` requis ; les autres champs sont optionnels. */
  addWeightEntry: (entry: Omit<WeightEntry, 'id' | 'createdAt'>) => string;
  updateWeightEntry: (id: string, patch: Partial<WeightEntry>) => void;
  removeWeightEntry: (id: string) => void;
  setWeightConfig: (patch: Partial<WeightConfig>) => void;

  /** Enregistre une sortie au soleil (section « Soleil » du jour). */
  addSunExposure: (e: Omit<SunExposure, 'id' | 'createdAt'>) => void;
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

      setSttEngine: (e) => set({ sttEngine: e }),
      setSttModel: (id) => set({ sttModel: id }),
      setLlmModel: (id) => set({ llmModel: id }),
      setExtractionMode: (m) => set({ extractionMode: m }),
      setCloudApiKey: (k) => set({ cloudApiKey: k }),
      setCloudModel: (id) => set({ cloudModel: id }),
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      setSyncCursor: (cursor) => set({ syncCursor: cursor }),

      addEntry: (transcript, items, source, date) => {
        const computed = computeItems(
          items,
          effectiveFoods(get().customFoods, get().foodOverrides),
          recentFoodCounts(get().entries),
        );
        const entry: JournalEntry = {
          id: uid(),
          date: date ?? todayStr(),
          createdAt: Date.now(),
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
              items: e.items.map((it) => ({ ...it, id: uid() })),
            }));
          return copies.length > 0 ? { entries: [...copies, ...s.entries] } : {};
        }),

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
          if (id.startsWith('custom-')) {
            return {
              customFoods: s.customFoods.map((f) =>
                f.id === id ? { ...f, ...patch, id, n: { ...f.n, ...(patch.n ?? {}) } } : f,
              ),
            };
          }
          // Aliment de la banque : override cumulatif persistant.
          const prev = s.foodOverrides[id];
          return {
            foodOverrides: {
              ...s.foodOverrides,
              [id]: { ...prev, ...patch, n: { ...(prev?.n ?? {}), ...(patch.n ?? {}) } },
            },
          };
        }),

      resetFood: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.foodOverrides;
          return { foodOverrides: rest };
        }),

      addWeightEntry: (entry) => {
        const full: WeightEntry = { ...entry, id: uid(), createdAt: Date.now() };
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

      addSunExposure: (e) =>
        set((s) => ({ sunExposures: [{ ...e, id: uid(), createdAt: Date.now() }, ...s.sunExposures] })),

      removeSunExposure: (id) =>
        set((s) => ({ sunExposures: s.sunExposures.filter((e) => e.id !== id) })),
    }),
    { name: 'foodrecorder-v1', merge: mergePersisted },
  ),
);

/** Complète un objet nutriments persisté avec les clés manquantes (nouveaux nutriments). */
function normalizeNutrients(n: Partial<Nutrients> | undefined): Nutrients {
  return { ...EMPTY_NUTRIENTS, ...(n ?? {}) };
}

/**
 * Fusion à l'hydratation : réconcilie l'état persisté avec l'état courant et
 * complète les nutriments figés (entrées + aliments custom) avec les clés
 * ajoutées depuis la dernière sauvegarde (sinon `undefined` → NaN dans les totaux).
 */
function mergePersisted(persisted: unknown, current: AppState): AppState {
  const p = (persisted ?? {}) as Partial<AppState>;
  const entries = (p.entries ?? []).map((e) => ({
    ...e,
    items: e.items.map((it) => ({
      ...it,
      nutrients: normalizeNutrients(it.nutrients),
      ...(it.customN ? { customN: normalizeNutrients(it.customN) } : {}),
    })),
  }));
  const customFoods = (p.customFoods ?? []).map((food) => ({ ...food, n: normalizeNutrients(food.n) }));
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

/** Totaux d'une journée donnée. */
export function dayTotals(entries: JournalEntry[], date: string): Nutrients {
  const items: ComputedItem[] = entries
    .filter((e) => e.date === date)
    .flatMap((e) => e.items.map((it) => ({ extracted: { aliment: it.nomAffiche, quantite: it.quantite, unite: it.unite, estimation: it.estimation }, match: { food: null, score: 1, douteux: false, alternatives: [] }, grams: it.grams, nutrients: it.nutrients })));
  return totalNutrients(items);
}

export { todayStr, nowTime };
