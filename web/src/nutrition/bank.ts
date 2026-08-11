/**
 * MA BANQUE d'aliments : les aliments réellement consommés.
 *
 * Deux ensembles cohabitent dans l'app, et il ne faut pas les confondre :
 *  - le CATALOGUE de référence (`FOODS`, en dur) : un réservoir de ~148 aliments
 *    courants qu'on peut copier, et la fixture du matching hors-ligne. Il n'est
 *    JAMAIS compté dans les stats — un aliment jamais mangé n'a rien à faire dans
 *    l'explorateur, les classements ou l'ACP.
 *  - MA BANQUE (`customFoods` dans le store) : tout ce qui a été mangé au moins
 *    une fois, d'où que ça vienne (copie du catalogue, estimation d'IA forte,
 *    saisie manuelle). C'est la seule source du matching, des calculs et des stats.
 *
 * Ce module tient la logique pure de la banque : identité des aliments,
 * naissance d'un aliment à partir d'une estimation IA, fusion de doublons, et la
 * migration unique depuis l'ancien modèle (catalogue en dur + overrides).
 */

import type { ComputedItem, Food, FoodCategory, Nutrients } from './types';
import { FOOD_BY_ID } from './foods';
import { normalizeNutrients, scaleNutrients, toGrams } from './compute';
import { normalizeForMatch, trigramSimilarity } from './normalize';
import type { FavoriteMeal, FoodPatch, JournalEntry } from '../store/store';

/**
 * Clé d'identité d'un aliment de banque : son nom normalisé (accents, casse et
 * pluriels effacés). C'est elle qui évite qu'une même chose dictée deux fois
 * (« pastel de nata », « Pastels de nata ») crée deux aliments.
 */
export function bankKey(nom: string): string {
  return normalizeForMatch(nom);
}

/**
 * Id d'un aliment né dans la banque (estimation IA). DÉTERMINISTE à dessein :
 * deux appareils qui reçoivent la même dictée, ou qui migrent leur historique
 * chacun de leur côté, produisent le même id — l'upsert Supabase converge alors
 * au lieu de créer un doublon par appareil.
 */
export function bankFoodId(nom: string): string {
  const slug = bankKey(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `mine-${slug || 'aliment'}`;
}

/** Index nom normalisé → aliment, pour retrouver un aliment déjà en banque. */
export function indexByKey(bank: Food[]): Map<string, Food> {
  const map = new Map<string, Food>();
  // Premier arrivé, premier servi : en cas de doublon de nom, l'aliment le plus
  // ancien fait référence (les suivants seront rattrapés par la fusion manuelle).
  for (const f of bank) {
    const k = bankKey(f.nom);
    if (k && !map.has(k)) map.set(k, f);
  }
  return map;
}

/** Retrouve un aliment de la banque par son nom (normalisé). */
export function findBankFood(bank: Food[], nom: string): Food | null {
  const k = bankKey(nom);
  if (!k) return null;
  return bank.find((f) => bankKey(f.nom) === k) ?? null;
}

/** Applique un ancien override utilisateur sur un aliment du catalogue (migration). */
export function applyOverride(food: Food, ov?: FoodPatch): Food {
  if (!ov) return food;
  return { ...food, ...ov, id: food.id, n: { ...food.n, ...(ov.n ?? {}) } };
}

/**
 * Copie un aliment du catalogue dans ma banque. L'ID EST CONSERVÉ : c'est ce qui
 * rend l'opération non destructive — toutes les références déjà posées dans le
 * journal et les repas favoris restent valides, et les tables indexées par id
 * (doses de compléments, répartition des AG saturés) continuent de s'appliquer.
 */
export function adoptFromCatalog(food: Food, ajouteLe?: string): Food {
  return { ...food, custom: true, origine: 'catalogue', sourceId: food.id, ...(ajouteLe ? { ajouteLe } : {}) };
}

/**
 * Crée un aliment de banque à partir d'une estimation d'IA forte (aliment hors
 * catalogue). Marqué « à vérifier » : ces valeurs n'ont jamais été relues, et
 * elles serviront désormais à toutes les consommations suivantes.
 */
export function foodFromEstimate(
  nom: string,
  n: Partial<Nutrients>,
  opts: { categorie?: FoodCategory; pieceGrams?: number; ajouteLe?: string } = {},
): Food {
  const g = opts.pieceGrams;
  return {
    id: bankFoodId(nom),
    nom,
    categorie: opts.categorie ?? 'autre',
    aliases: [],
    ...(g ? { pieceGrams: g, unitGrams: { portion: g } } : {}),
    // Une estimation venue d'un historique ancien peut manquer des nutriments
    // ajoutés depuis : sans complétion, ils ressortiraient en NaN.
    n: normalizeNutrients(n),
    custom: true,
    origine: 'ia',
    aVerifier: true,
    ...(opts.ajouteLe ? { ajouteLe: opts.ajouteLe } : {}),
  };
}

// ---------------------------------------------------------------------------
// Entrée dans la banque à la saisie
// ---------------------------------------------------------------------------

/**
 * Promeut en aliments de banque les estimations d'IA forte d'une saisie.
 *
 * Un aliment hors catalogue estimé par l'IA n'est plus enfermé dans son item de
 * journal : il devient un aliment à part entière, et c'est LUI qui servira à
 * toutes les consommations suivantes. Si le même nom est déjà en banque, ses
 * valeurs FIGÉES l'emportent sur la nouvelle estimation — sans quoi le même plat
 * vaudrait 240 kcal lundi et 310 kcal jeudi, et les courbes ne voudraient plus
 * rien dire. Pour corriger, on édite l'aliment : la correction est rétroactive.
 */
export function ingestEstimates(
  bank: Food[],
  computed: ComputedItem[],
  jour: string,
): { customFoods: Food[]; computed: ComputedItem[] } {
  if (!computed.some((ci) => ci.aiEstime && ci.extracted.nutriments)) return { customFoods: bank, computed };

  const nextBank = [...bank];
  const byKey = indexByKey(nextBank);

  const next = computed.map((ci) => {
    if (!ci.aiEstime || !ci.extracted.nutriments) return ci;
    const nom = ci.extracted.aliment;
    const k = bankKey(nom);
    if (!k) return ci;

    let food = byKey.get(k);
    if (!food) {
      food = foodFromEstimate(nom, ci.extracted.nutriments, {
        categorie: ci.extracted.categorie,
        pieceGrams: ci.extracted.grammesParPiece,
        ajouteLe: jour,
      });
      // Un id déterministe peut déjà être pris par un aliment au nom différent
      // mais de clé identique : on ne duplique pas, on réutilise l'existant.
      const clash = nextBank.find((f) => f.id === food!.id);
      if (clash) food = clash;
      else nextBank.push(food);
      byKey.set(k, food);
    }

    // Recalcul depuis l'aliment de banque : ses valeurs font foi, pas celles que
    // l'IA vient de renvoyer.
    const grams = toGrams(ci.extracted, food);
    return {
      ...ci,
      match: { food, score: 1, douteux: false, alternatives: ci.match.alternatives },
      grams,
      nutrients: scaleNutrients(food.n, grams),
      aiEstime: false,
    };
  });

  return { customFoods: nextBank, computed: next };
}

// ---------------------------------------------------------------------------
// Migration depuis l'ancien modèle (catalogue en dur + overrides + iaEstime)
// ---------------------------------------------------------------------------

export interface BankMigrationInput {
  entries: JournalEntry[];
  customFoods: Food[];
  foodOverrides: Record<string, FoodPatch>;
  favoriteMeals: FavoriteMeal[];
}

export interface BankMigrationResult {
  customFoods: Food[];
  entries: JournalEntry[];
}

/**
 * Constitue la banque personnelle à partir de l'historique existant.
 *
 * Trois sources y entrent :
 *  1. les aliments perso déjà saisis (inchangés, marqués 'manuel') ;
 *  2. les aliments du catalogue RÉELLEMENT consommés (ou explicitement édités —
 *     un override signe un aliment auquel l'utilisateur tient), copiés avec leur
 *     id et leurs modifications fusionnées ;
 *  3. les estimations d'IA jusqu'ici enfermées dans les items du journal
 *     (`iaEstime`), promues en aliments à part entière et dédoublonnées par nom.
 *
 * Les aliments du catalogue jamais mangés ne sont PAS repris : c'est tout
 * l'objet du chantier. Les items non résolus SANS estimation (aliment jamais
 * reconnu) restent en l'état — il n'existe aucune valeur nutritionnelle à leur
 * donner.
 *
 * La fonction est IDEMPOTENTE (ids déterministes, aucune création si l'item est
 * déjà rattaché) : sûre à rejouer, y compris sur un second appareil.
 */
export function migrateToPersonalBank(input: BankMigrationInput): BankMigrationResult {
  const bank = new Map<string, Food>();
  const byKey = new Map<string, string>();

  const remember = (food: Food) => {
    bank.set(food.id, food);
    const k = bankKey(food.nom);
    if (k && !byKey.has(k)) byKey.set(k, food.id);
  };

  // 1) Aliments perso existants : ils sont déjà « à moi ».
  for (const f of input.customFoods) {
    remember({ ...f, custom: true, origine: f.origine ?? 'manuel', n: normalizeNutrients(f.n) });
  }

  // 2) Aliments du catalogue référencés quelque part, ou édités par l'utilisateur.
  const referenced = new Set<string>();
  for (const e of input.entries) for (const it of e.items) if (it.foodId) referenced.add(it.foodId);
  for (const m of input.favoriteMeals) for (const it of m.items) if (it.foodId) referenced.add(it.foodId);
  for (const id of Object.keys(input.foodOverrides)) referenced.add(id);

  for (const id of referenced) {
    if (bank.has(id)) continue;
    const fromCatalog = FOOD_BY_ID.get(id);
    // id inconnu du catalogue (aliment perso supprimé depuis) : rien à copier,
    // l'item gardera son snapshot figé — comportement déjà en place.
    if (!fromCatalog) continue;
    remember(adoptFromCatalog(applyOverride(fromCatalog, input.foodOverrides[id])));
  }

  // 3) Estimations IA → aliments de banque. Parcours chronologique : à noms
  // identiques, ce sont les valeurs de la consommation la PLUS RÉCENTE qui font
  // foi (dernière estimation en date = la mieux informée), et elles seront de
  // toute façon appliquées rétroactivement à tout l'historique.
  const chrono = [...input.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  for (const e of chrono) {
    for (const it of e.items) {
      if (it.foodId || !it.iaEstime) continue;
      const k = bankKey(it.nomAffiche);
      if (!k) continue;
      const existingId = byKey.get(k);
      if (existingId) {
        const prev = bank.get(existingId);
        // On ne réécrit qu'un aliment issu d'une estimation : un aliment perso ou
        // une copie du catalogue portant le même nom fait autorité sur l'IA.
        if (prev?.origine === 'ia') {
          bank.set(existingId, {
            ...prev,
            nom: it.nomAffiche,
            categorie: it.categorie ?? prev.categorie,
            n: normalizeNutrients(it.iaEstime.n),
            ...(it.iaEstime.pieceGrams
              ? { pieceGrams: it.iaEstime.pieceGrams, unitGrams: { ...prev.unitGrams, portion: it.iaEstime.pieceGrams } }
              : {}),
          });
        }
        continue;
      }
      remember(
        foodFromEstimate(it.nomAffiche, it.iaEstime.n, {
          categorie: it.categorie,
          pieceGrams: it.iaEstime.pieceGrams,
          ajouteLe: e.date,
        }),
      );
    }
  }

  // 4) Rattacher les items estimés à leur nouvel aliment. `iaEstime` est retiré :
  // les valeurs vivent désormais dans la banque, et l'item s'y resynchronise
  // automatiquement (cf. resolveItemNutrients).
  const entries = input.entries.map((e) => ({
    ...e,
    items: e.items.map((it) => {
      if (it.foodId || !it.iaEstime) return it;
      const id = byKey.get(bankKey(it.nomAffiche));
      if (!id) return it;
      const { iaEstime: _drop, ...rest } = it;
      return { ...rest, foodId: id };
    }),
  }));

  return { customFoods: [...bank.values()], entries };
}

// ---------------------------------------------------------------------------
// Fusion de deux aliments (entretien de la banque)
// ---------------------------------------------------------------------------

export interface MergeResult {
  customFoods: Food[];
  entries: JournalEntry[];
  favoriteMeals: FavoriteMeal[];
  /** Nombre d'items de journal repointés (pour le retour utilisateur). */
  itemsRepointes: number;
}

/**
 * Fusionne `sourceId` dans `targetId` : la cible garde son id, son nom et ses
 * valeurs ; l'absorbé disparaît et tout ce qui le référençait bascule sur la cible.
 *
 * Le NOM de l'absorbé devient un alias de la cible — sans ça, la prochaine dictée
 * recréerait le doublon qu'on vient tout juste de supprimer.
 */
export function mergeBankFoods(
  customFoods: Food[],
  entries: JournalEntry[],
  favoriteMeals: FavoriteMeal[],
  sourceId: string,
  targetId: string,
): MergeResult {
  const source = customFoods.find((f) => f.id === sourceId);
  const target = customFoods.find((f) => f.id === targetId);
  if (!source || !target || sourceId === targetId) {
    return { customFoods, entries, favoriteMeals, itemsRepointes: 0 };
  }

  const seen = new Set([bankKey(target.nom), ...target.aliases.map(bankKey)]);
  const aliases = [...target.aliases];
  for (const a of [source.nom, ...source.aliases]) {
    const k = bankKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    aliases.push(a);
  }

  const merged: Food = {
    ...target,
    aliases,
    // Un aliment confirmé qui absorbe un douteux reste confirmé, et l'inverse
    // vaut aussi : la fusion est un acte de relecture.
    ...(target.aVerifier && !source.aVerifier ? { aVerifier: undefined } : {}),
  };

  let itemsRepointes = 0;
  const nextEntries = entries.map((e) => ({
    ...e,
    items: e.items.map((it) => {
      if (it.foodId !== sourceId) return it;
      itemsRepointes++;
      return { ...it, foodId: targetId, nomAffiche: merged.nom };
    }),
  }));

  const nextFavorites = favoriteMeals.map((m) => ({
    ...m,
    items: m.items.map((it) => (it.foodId === sourceId ? { ...it, foodId: targetId, nomAffiche: merged.nom } : it)),
  }));

  return {
    customFoods: customFoods.filter((f) => f.id !== sourceId).map((f) => (f.id === targetId ? merged : f)),
    entries: nextEntries,
    favoriteMeals: nextFavorites,
    itemsRepointes,
  };
}

/** Paire d'aliments de la banque dont les noms se ressemblent assez pour être un doublon. */
export interface DuplicatePair {
  a: Food;
  b: Food;
  score: number;
}

/**
 * Doublons probables de la banque : paires de noms très proches. Sert à repérer
 * « pastel de nata » vs « pasteis de nata », que la clé d'identité (nom normalisé)
 * ne peut pas rapprocher toute seule. Purement indicatif — la fusion reste manuelle.
 */
export function findDuplicates(bank: Food[], seuil = 0.6): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const keys = bank.map((f) => bankKey(f.nom));
  for (let i = 0; i < bank.length; i++) {
    for (let j = i + 1; j < bank.length; j++) {
      const score = trigramSimilarity(keys[i], keys[j]);
      if (score >= seuil) out.push({ a: bank[i], b: bank[j], score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
