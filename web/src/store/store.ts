import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ComputedItem, ExtractedItem, Food, Nutrients, Unit } from '../nutrition/types';
import { computeItems, totalNutrients, toGrams, scaleNutrients } from '../nutrition/compute';
import { FOOD_BY_ID } from '../nutrition/foods';
import { DEFAULT_LLM_MODEL } from '../extraction/llm';
import { DEFAULT_CLOUD_MODEL } from '../extraction/anthropic';
import { DEFAULT_STT_MODEL } from '../stt/whisper';

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
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  transcript: string;
  source: 'llm' | 'anthropic' | 'rules' | 'manuel';
  items: JournalItem[];
}

/** Choix du moteur d'extraction. */
export type ExtractionMode = 'rules' | 'local' | 'cloud';

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
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
    nutrients: ci.nutrients ?? emptyNutrients(),
    estimation: ci.extracted.estimation,
    douteux: ci.match.douteux || ci.match.food === null,
  };
}

function emptyNutrients(): Nutrients {
  return {
    kcal: 0, proteines: 0, glucides: 0, lipides: 0, fibres: 0, agSatures: 0,
    fer: 0, magnesium: 0, potassium: 0, calcium: 0, zinc: 0, sodium: 0,
    selenium: 0, iode: 0, vitA: 0, vitC: 0, vitD: 0, vitE: 0,
    vitK1: 0, vitK2: 0, vitB9: 0, vitB12: 0, creatine: 0,
  };
}

interface AppState {
  entries: JournalEntry[];
  customFoods: Food[];
  sttModel: string;
  llmModel: string;
  extractionMode: ExtractionMode;
  cloudApiKey: string;
  cloudModel: string;

  setSttModel: (id: string) => void;
  setLlmModel: (id: string) => void;
  setExtractionMode: (m: ExtractionMode) => void;
  setCloudApiKey: (k: string) => void;
  setCloudModel: (id: string) => void;

  /** Enregistre automatiquement une entrée (auto-validation, plan §Phase 4). */
  addEntry: (transcript: string, items: ExtractedItem[], source: JournalEntry['source']) => string;
  /** Ajout manuel d'un aliment choisi explicitement (pas de matching flou). */
  addFoodEntry: (food: Food, quantite: number, unite: Unit) => string;
  updateItem: (entryId: string, itemId: string, patch: Partial<JournalItem>) => void;
  removeItem: (entryId: string, itemId: string) => void;
  addItemToEntry: (entryId: string, item: ExtractedItem) => void;
  removeEntry: (entryId: string) => void;

  addCustomFood: (food: Omit<Food, 'id' | 'custom'>) => void;
  removeCustomFood: (id: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      entries: [],
      customFoods: [],
      sttModel: DEFAULT_STT_MODEL,
      llmModel: DEFAULT_LLM_MODEL,
      extractionMode: 'rules',
      cloudApiKey: '',
      cloudModel: DEFAULT_CLOUD_MODEL,

      setSttModel: (id) => set({ sttModel: id }),
      setLlmModel: (id) => set({ llmModel: id }),
      setExtractionMode: (m) => set({ extractionMode: m }),
      setCloudApiKey: (k) => set({ cloudApiKey: k }),
      setCloudModel: (id) => set({ cloudModel: id }),

      addEntry: (transcript, items, source) => {
        const computed = computeItems(items, get().customFoods);
        const entry: JournalEntry = {
          id: uid(),
          date: todayStr(),
          createdAt: Date.now(),
          transcript,
          source,
          items: computed.map(toJournalItem),
        };
        set((s) => ({ entries: [entry, ...s.entries] }));
        return entry.id;
      },

      addFoodEntry: (food, quantite, unite) => {
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
          date: todayStr(),
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
              : { ...e, items: e.items.map((it) => (it.id === itemId ? recomputeItem({ ...it, ...patch }, get().customFoods) : it)) },
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
            const [ci] = computeItems([item], get().customFoods);
            return { ...e, items: [...e.items, toJournalItem(ci)] };
          }),
        })),

      removeEntry: (entryId) => set((s) => ({ entries: s.entries.filter((e) => e.id !== entryId) })),

      addCustomFood: (food) =>
        set((s) => ({ customFoods: [{ ...food, id: `custom-${uid()}`, custom: true }, ...s.customFoods] })),

      removeCustomFood: (id) => set((s) => ({ customFoods: s.customFoods.filter((f) => f.id !== id) })),
    }),
    { name: 'foodrecorder-v1' },
  ),
);

/** Recalcule grams + nutriments d'un item quand foodId/quantité/unité changent. */
function recomputeItem(item: JournalItem, customFoods: Food[]): JournalItem {
  // Si un aliment est explicitement associé, on l'utilise directement (pas de re-matching).
  const food: Food | null = item.foodId
    ? FOOD_BY_ID.get(item.foodId) ?? customFoods.find((f) => f.id === item.foodId) ?? null
    : null;

  if (food) {
    const grams = toGrams({ aliment: food.nom, quantite: item.quantite, unite: item.unite, estimation: item.estimation }, food);
    return { ...item, nomAffiche: food.nom, grams, nutrients: scaleNutrients(food.n, grams), douteux: false };
  }

  // Aliment non résolu : on re-matche le texte affiché.
  const [ci] = computeItems(
    [{ aliment: item.nomAffiche, quantite: item.quantite, unite: item.unite, estimation: item.estimation }],
    customFoods,
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

export { todayStr };
