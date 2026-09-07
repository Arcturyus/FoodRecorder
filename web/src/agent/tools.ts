import { z } from 'zod';
import { RDA, nutrientLabelOf } from '../nutrition/rda';
import { computeTargets } from '../nutrition/targets';
import type { FoodCategory, NutrientKey, Nutrients } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { effectiveFoods, isDayCounted, useStore } from '../store/store';
import { groupIntoMeals } from '../ui/meals';
import { computeWeight } from '../weight/compute';
import { foodFrequencies, nutrientContributions } from '../nutrition/frequency';
import { computePeriodNutrition } from '../nutrition/periodNutrition';
import { DECAY_HALF_LIFE_DEFAULT } from '../nutrition/recommend';
import { vitaminDBreakdown, SUN_DAY_CAP } from '../sun/vitaminD';
import { normalizeForMatch } from '../nutrition/normalize';
import type { WeightMetricKey } from '../weight/types';
import type { AgentTool } from './protocol';
import { ACTION_TOOLS } from './actions';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_RE, 'Date attendue au format YYYY-MM-DD');
const rangeObject = z.object({ debut: dateSchema, fin: dateSchema });
const validRange = <T extends { debut: string; fin: string }>(schema: z.ZodType<T>) => schema.refine((v) => v.debut <= v.fin, {
  message: 'La date de début doit précéder la date de fin.',
});
const nutrientKeys = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];
const nutrientSchema = z.enum(nutrientKeys as [NutrientKey, ...NutrientKey[]]);
const foodCategories = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const satisfies readonly FoodCategory[];
const foodCategorySchema = z.enum(foodCategories);
const nutrientMeta = new Map(RDA.map((r) => [r.key, { label: r.label, unit: r.unit }]));

function round(v: number, digits = 3): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function bodyContext() {
  const s = useStore.getState();
  const latestFat = [...s.weightEntries]
    .filter((e) => e.masseGrasse != null)
    .sort((a, b) => `${b.date} ${b.heure}`.localeCompare(`${a.date} ${a.heure}`))[0]?.masseGrasse;
  return {
    tailleCm: Math.round(s.weightConfig.taille * 100),
    age: s.weightConfig.age,
    ...(latestFat != null ? { masseGrassePct: latestFat } : {}),
  };
}

function targets() {
  const s = useStore.getState();
  return new Map(computeTargets(s.profile, bodyContext(), s.nutrientTargets).map((t) => [t.key, t]));
}

function selectedKeys(keys?: NutrientKey[]): NutrientKey[] {
  return keys?.length ? keys : nutrientKeys;
}

function nutrientRows(values: Nutrients, keys?: NutrientKey[]) {
  const byTarget = targets();
  return selectedKeys(keys).map((key) => {
    const meta = nutrientMeta.get(key);
    const target = byTarget.get(key);
    const value = round(values[key]);
    return {
      key,
      label: meta?.label ?? nutrientLabelOf(key),
      unit: meta?.unit ?? '',
      value,
      target: target ? { goal: target.goal, ajr: target.ajr, optimal: target.optimal } : null,
      coveragePercent: target?.optimal ? round((value / target.optimal) * 100, 1) : null,
    };
  });
}

function sumEntries(debut: string, fin: string, sansSupplements: boolean) {
  const s = useStore.getState();
  const supplementIds = new Set(
    effectiveFoods(s.customFoods).filter((f) => f.categorie === 'supplement').map((f) => f.id),
  );
  const byDate = new Map<string, Nutrients>();
  for (const entry of s.entries) {
    if (entry.date < debut || entry.date > fin) continue;
    for (const item of entry.items) {
      if (sansSupplements && item.foodId && supplementIds.has(item.foodId)) continue;
      let total = byDate.get(entry.date);
      if (!total) {
        total = { ...EMPTY_NUTRIENTS };
        byDate.set(entry.date, total);
      }
      for (const key of nutrientKeys) total[key] += item.nutrients[key] ?? 0;
    }
  }
  return byDate;
}

const lireRepasArgs = z.union([
  z.object({ date: dateSchema, detail: z.enum(['resume', 'aliments', 'complet']).default('aliments'), nutriments: z.array(nutrientSchema).optional() }),
  validRange(rangeObject.extend({ aliment: z.string().trim().min(1).optional(), detail: z.enum(['resume', 'aliments', 'complet']).default('aliments'), nutriments: z.array(nutrientSchema).optional() })),
]);

const lireRepas: AgentTool<z.infer<typeof lireRepasArgs>> = {
  name: 'lire_repas',
  description: 'Lit en détail les repas et aliments consommés à une date ou sur une période inclusive.',
  policy: 'read',
  schema: lireRepasArgs,
  jsonSchema: {
    oneOf: [
      { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, detail: { type: 'string', enum: ['resume', 'aliments', 'complet'] }, nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } } }, required: ['date'], additionalProperties: false },
      { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, aliment: { type: 'string' }, detail: { type: 'string', enum: ['resume', 'aliments', 'complet'] }, nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } } }, required: ['debut', 'fin'], additionalProperties: false },
    ],
  },
  run(args) {
    const s = useStore.getState();
    const debut = 'date' in args ? args.date : args.debut;
    const fin = 'date' in args ? args.date : args.fin;
    const query = 'aliment' in args ? args.aliment?.toLocaleLowerCase('fr') : undefined;
    const detail = args.detail ?? 'aliments';
    const selectedNutrients = args.nutriments;
    const days = [...new Set(s.entries.filter((e) => e.date >= debut && e.date <= fin).map((e) => e.date))].sort();
    return {
      period: { debut, fin, inclusive: true },
      days: days.map((date) => {
        const entries = s.entries.filter((e) => e.date === date);
        const meals = groupIntoMeals(entries).map((meal) => ({
          start: new Date(meal.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          entries: meal.entries.map((entry) => ({
            id: entry.id,
            ...(detail === 'complet' ? { transcript: entry.transcript, source: entry.source } : {}),
            items: entry.items
              .filter((item) => !query || item.nomAffiche.toLocaleLowerCase('fr').includes(query))
              .map((item) => ({
                id: item.id,
                foodId: item.foodId,
                name: item.nomAffiche,
                quantity: item.quantite,
                unit: item.unite,
                grams: round(item.grams, 1),
                estimated: item.estimation,
                ...(detail === 'complet' || selectedNutrients?.length
                  ? { nutrients: nutrientRows(item.nutrients, selectedNutrients).filter((n) => n.value !== 0) }
                  : {}),
              })),
          })).filter((entry) => entry.items.length > 0),
        })).filter((meal) => meal.entries.length > 0);
        return detail === 'resume'
          ? { date, countedInAverages: isDayCounted(s.mutedDays, entries.length > 0, date), mealCount: meals.length, entryCount: entries.length, foods: meals.flatMap((meal) => meal.entries.flatMap((entry) => entry.items.map((item) => item.name))) }
          : { date, countedInAverages: isDayCounted(s.mutedDays, entries.length > 0, date), note: s.dayNotes[date] ?? null, meals };
      }).filter((day) => Array.isArray((day as any).meals) ? (day as any).meals.length > 0 : (day as any).entryCount > 0),
    };
  },
};

const lireNutrimentsArgs = z.object({
  date: dateSchema,
  nutriments: z.array(nutrientSchema).max(nutrientKeys.length).optional(),
  inclureSoleil: z.boolean().default(true),
});

const lireNutriments: AgentTool<z.infer<typeof lireNutrimentsArgs>> = {
  name: 'lire_nutriments',
  description: 'Lit les apports nutritionnels détaillés d’un jour, leurs objectifs et la contribution solaire éventuelle.',
  policy: 'read',
  schema: lireNutrimentsArgs,
  jsonSchema: { type: 'object', properties: { date: { type: 'string' }, nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } }, inclureSoleil: { type: 'boolean' } }, required: ['date'], additionalProperties: false },
  run({ date, nutriments, inclureSoleil }) {
    const s = useStore.getState();
    const totals = sumEntries(date, date, false).get(date) ?? { ...EMPTY_NUTRIENTS };
    const exposures = s.sunExposures.filter((e) => e.date === date).map((e) => ({ exposure: e, breakdown: vitaminDBreakdown(e) }));
    const sunGain = Math.min(exposures.reduce((sum, e) => sum + e.breakdown.gain, 0), SUN_DAY_CAP);
    const withSun = inclureSoleil ? { ...totals, vitD: totals.vitD + sunGain } : totals;
    return {
      date,
      countedInAverages: isDayCounted(s.mutedDays, s.entries.some((e) => e.date === date), date),
      filters: { inclureSoleil },
      nutrients: nutrientRows(withSun, nutriments),
      ...(!nutriments?.length || nutriments.includes('vitD')
        ? { vitaminD: { foodMicrograms: round(totals.vitD), sunMicrograms: round(sunGain), totalMicrograms: round(withSun.vitD), exposures } }
        : {}),
    };
  },
};

const moyenneArgs = validRange(rangeObject.extend({
  nutriments: z.array(nutrientSchema).max(nutrientKeys.length).optional(),
  sansSupplements: z.boolean().default(false),
  inclureSoleil: z.boolean().default(true),
  ponderation: z.enum(['simple', 'recente']).default('simple'),
  demiVieJours: z.number().min(1).max(365).default(DECAY_HALF_LIFE_DEFAULT),
  detail: z.enum(['resume', 'quotidien']).default('resume'),
}));

const moyenneNutriments: AgentTool<z.infer<typeof moyenneArgs>> = {
  name: 'moyenne_nutriments',
  description: 'Calcule la moyenne journalière détaillée de nutriments sur les jours enregistrés d’une période inclusive.',
  policy: 'read',
  schema: moyenneArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } }, sansSupplements: { type: 'boolean' }, inclureSoleil: { type: 'boolean' }, ponderation: { type: 'string', enum: ['simple', 'recente'] }, demiVieJours: { type: 'number', minimum: 1, maximum: 365 }, detail: { type: 'string', enum: ['resume', 'quotidien'] } }, required: ['debut', 'fin'], additionalProperties: false },
  run({ debut, fin, nutriments, sansSupplements, inclureSoleil, ponderation, demiVieJours, detail }) {
    const s = useStore.getState();
    const excludeSupplements = sansSupplements ?? false;
    const includeSun = inclureSoleil ?? true;
    const foods = effectiveFoods(s.customFoods);
    const computed = computePeriodNutrition({ entries: s.entries, sunExposures: s.sunExposures, mutedDays: s.mutedDays, foods }, { range: { start: debut, end: fin }, includeToday: true, excludeSupplements, includeSun, decayOn: ponderation === 'recente', halfLife: demiVieJours ?? DECAY_HALF_LIFE_DEFAULT });
    const daily = computed.recorded.map((date) => ({ date, foodVitaminD: round(computed.byDate.get(date)?.vitD ?? 0), sunVitaminD: round((computed.byDateVitD.get(date)?.vitD ?? 0) - (computed.byDate.get(date)?.vitD ?? 0)), nutrients: nutrientRows(computed.byDateVitD.get(date) ?? EMPTY_NUTRIENTS, nutriments) }));
    return { period: { debut, fin, inclusive: true }, filters: { sansSupplements: excludeSupplements, inclureSoleil: includeSun, ponderation: ponderation ?? 'simple', demiVieJours: demiVieJours ?? DECAY_HALF_LIFE_DEFAULT }, recordedDays: computed.recorded.length, averages: nutrientRows(computed.averages, nutriments), ...((detail ?? 'resume') === 'quotidien' ? { dates: computed.recorded, daily } : {}) };
  },
};

const weightMetrics = ['poids', 'masseGrasse', 'eau', 'masseMusculaire', 'masseOsseuse', 'graisseViscerale', 'metabolismeBasalMachine'] as const satisfies readonly WeightMetricKey[];
const lirePoidsArgs = validRange(rangeObject.extend({ detail: z.enum(['resume', 'serie', 'complet']).default('serie'), mesures: z.array(z.enum(weightMetrics)).optional() }));
const lirePoids: AgentTool<z.infer<typeof lirePoidsArgs>> = {
  name: 'lire_poids',
  description: 'Lit toutes les pesées d’une période avec mesures brutes et indicateurs recalculés.',
  policy: 'read',
  schema: lirePoidsArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, detail: { type: 'string', enum: ['resume', 'serie', 'complet'] }, mesures: { type: 'array', items: { type: 'string', enum: weightMetrics } } }, required: ['debut', 'fin'], additionalProperties: false },
  run({ debut, fin, detail, mesures }) {
    const s = useStore.getState();
    const keys = mesures?.length ? mesures : ['poids'] as WeightMetricKey[];
    const raw = s.weightEntries.filter((e) => e.date >= debut && e.date <= fin).sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`));
    const measurements = raw.map((entry) => (detail ?? 'serie') === 'complet'
      ? { ...entry, computed: computeWeight(entry, s.weightConfig, s.profile.sexe) }
      : { id: entry.id, date: entry.date, heure: entry.heure, ...Object.fromEntries(keys.map((key) => [key, entry[key] ?? null])) });
    const first = raw[0];
    const last = raw[raw.length - 1];
    return { period: { debut, fin, inclusive: true }, count: measurements.length, changeKg: first && last ? round(last.poids - first.poids, 2) : null, ...((detail ?? 'serie') === 'resume' ? {} : { measurements }), ...((detail ?? 'serie') === 'complet' ? { config: s.weightConfig } : {}) };
  },
};

const lireSoleilArgs = validRange(rangeObject.extend({ detail: z.enum(['totaux', 'parJour', 'complet']).default('parJour') }));
const lireSoleil: AgentTool<z.infer<typeof lireSoleilArgs>> = {
  name: 'lire_soleil',
  description: 'Lit chaque exposition solaire et tous les facteurs utilisés pour estimer la vitamine D, pas seulement le total.',
  policy: 'read',
  schema: lireSoleilArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, detail: { type: 'string', enum: ['totaux', 'parJour', 'complet'] } }, required: ['debut', 'fin'], additionalProperties: false },
  run({ debut, fin, detail }) {
    const exposures = useStore.getState().sunExposures.filter((e) => e.date >= debut && e.date <= fin).sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`)).map((exposure) => ({ exposure, calculation: vitaminDBreakdown(exposure) }));
    const byDate: Record<string, { uncappedMicrograms: number; cappedMicrograms: number }> = {};
    for (const row of exposures) {
      const current = byDate[row.exposure.date] ?? { uncappedMicrograms: 0, cappedMicrograms: 0 };
      current.uncappedMicrograms += row.calculation.gain;
      current.cappedMicrograms = Math.min(current.uncappedMicrograms, SUN_DAY_CAP);
      byDate[row.exposure.date] = current;
    }
    const totalMicrograms = round(Object.values(byDate).reduce((sum, day) => sum + day.cappedMicrograms, 0));
    return { period: { debut, fin, inclusive: true }, exposureCount: exposures.length, totalMicrograms, model: { locationAssumption: 'France métropolitaine, latitude approximative 44–50° N', dailyCapMicrograms: SUN_DAY_CAP, isEstimate: true }, ...((detail ?? 'parJour') === 'totaux' ? {} : { totalsByDate: byDate }), ...((detail ?? 'parJour') === 'complet' ? { exposures } : {}) };
  },
};

const limiteSchema = z.number().int().min(1).max(50).default(10);
const classementArgs = validRange(rangeObject.extend({ limite: limiteSchema }));
const classerManquesExces: AgentTool<z.infer<typeof classementArgs>> = {
  name: 'classer_manques_exces',
  description: 'Classe les nutriments les plus éloignés de leurs objectifs sur une période, avec valeurs, unités et couvertures.',
  policy: 'read',
  schema: classementArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['debut', 'fin'], additionalProperties: false },
  async run({ debut, fin, limite }) {
    const data = await moyenneNutriments.run({ debut, fin, sansSupplements: false, inclureSoleil: true }) as any;
    const rows = (data.averages as any[]).filter((r) => r.target?.ajr > 0 && r.key !== 'kcal');
    const manque = [...rows].filter((r) => r.target.goal !== 'limit').sort((a, b) => (a.coveragePercent ?? 0) - (b.coveragePercent ?? 0)).slice(0, limite ?? 10);
    const exces = [...rows].filter((r) => r.target.goal === 'limit').sort((a, b) => (b.coveragePercent ?? 0) - (a.coveragePercent ?? 0)).slice(0, limite ?? 10);
    return { period: data.period, recordedDays: data.recordedDays, manque, exces, interpretation: 'Couverture descriptive des objectifs de l’app, pas un diagnostic biologique.' };
  },
};

const contributionArgs = validRange(rangeObject.extend({ nutriment: nutrientSchema, limite: limiteSchema }));
const contributionsNutriment: AgentTool<z.infer<typeof contributionArgs>> = {
  name: 'contributions_nutriment',
  description: 'Classe les aliments ayant réellement contribué à un nutriment sur une période et donne le détail par date.',
  policy: 'read',
  schema: contributionArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, nutriment: { type: 'string', enum: nutrientKeys }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['debut', 'fin', 'nutriment'], additionalProperties: false },
  run({ debut, fin, nutriment, limite }) {
    return { period: { debut, fin, inclusive: true }, nutrient: { key: nutriment, label: nutrientLabelOf(nutriment), unit: nutrientMeta.get(nutriment)?.unit ?? '' }, contributions: nutrientContributions(useStore.getState().entries, { start: debut, end: fin }, nutriment).slice(0, limite ?? 10).map((c) => ({ ...c, parDate: Object.fromEntries(c.parDate) })) };
  },
};

const frequencesArgs = validRange(rangeObject.extend({ limite: limiteSchema }));
const frequencesAliments: AgentTool<z.infer<typeof frequencesArgs>> = {
  name: 'frequences_aliments',
  description: 'Classe les aliments les plus consommés avec occurrences, jours, grammes, calories et dates.',
  policy: 'read',
  schema: frequencesArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['debut', 'fin'], additionalProperties: false },
  run({ debut, fin, limite }) {
    const s = useStore.getState(); const foods = new Map(effectiveFoods(s.customFoods).map((f) => [f.id, f.categorie]));
    return { period: { debut, fin, inclusive: true }, foods: foodFrequencies(s.entries, { start: debut, end: fin }, (id) => foods.get(id)).slice(0, limite ?? 10) };
  },
};

const profileSection = z.enum(['profil', 'corps', 'poids', 'objectifs']);
const profileArgs = z.object({ sections: z.array(profileSection).optional() });
const lireProfilObjectifs: AgentTool<z.infer<typeof profileArgs>> = {
  name: 'lire_profil_objectifs',
  description: 'Lit le profil, les paramètres corporels et toutes les cibles nutritionnelles actives utilisées par l’application.',
  policy: 'read',
  schema: profileArgs,
  jsonSchema: { type: 'object', properties: { sections: { type: 'array', items: { type: 'string', enum: ['profil', 'corps', 'poids', 'objectifs'] } } }, additionalProperties: false },
  run({ sections }) {
    const s = useStore.getState();
    const selected = new Set(sections?.length ? sections : ['profil', 'corps', 'poids', 'objectifs']);
    return {
      ...(selected.has('profil') ? { profile: s.profile } : {}),
      ...(selected.has('corps') ? { body: bodyContext() } : {}),
      ...(selected.has('poids') ? { weightConfig: s.weightConfig } : {}),
      ...(selected.has('objectifs') ? { targets: [...targets().values()], customTargetOverrides: s.nutrientTargets } : {}),
    };
  },
};

const rechercherAlimentsArgs = z.object({ requete: z.string().trim().min(1), limite: limiteSchema });
const rechercherAlimentsBanque: AgentTool<z.infer<typeof rechercherAlimentsArgs>> = {
  name: 'rechercher_aliments_banque',
  description: 'Recherche des fiches dans la banque personnelle et renvoie leurs identifiants avant une lecture, édition ou fusion.',
  policy: 'read',
  schema: rechercherAlimentsArgs,
  jsonSchema: { type: 'object', properties: { requete: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['requete'], additionalProperties: false },
  run({ requete, limite }) {
    const query = normalizeForMatch(requete);
    const foods = effectiveFoods(useStore.getState().customFoods)
      .map((food) => {
        const names = [food.nom, ...food.aliases];
        const exact = names.some((name) => normalizeForMatch(name) === query);
        const partial = names.some((name) => normalizeForMatch(name).includes(query));
        return { food, score: exact ? 2 : partial ? 1 : 0 };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.food.nom.localeCompare(b.food.nom, 'fr'))
      .slice(0, limite ?? 10)
      .map(({ food }) => ({ id: food.id, name: food.nom, aliases: food.aliases, category: food.categorie, source: food.origine ?? 'catalogue', needsReview: !!food.aVerifier }));
    return { query: requete, count: foods.length, foods };
  },
};

const lireAlimentsBanqueArgs = z.object({
  requete: z.string().trim().min(1).optional(),
  categories: z.array(foodCategorySchema).min(1).optional(),
  origines: z.array(z.enum(['catalogue', 'ia', 'manuel'])).min(1).optional(),
  aVerifier: z.boolean().optional(),
  nutriments: z.array(nutrientSchema).min(1).optional(),
  detail: z.enum(['identite', 'nutriments', 'complet']).default('nutriments'),
  offset: z.number().int().min(0).default(0),
  limite: z.number().int().min(1).max(200).default(50),
});

const lireAlimentsBanque: AgentTool<z.infer<typeof lireAlimentsBanqueArgs>> = {
  name: 'lire_aliments_banque',
  description: 'Liste et filtre les aliments déjà adoptés dans la banque personnelle par texte, catégorie, origine ou statut à vérifier. Renvoie certains nutriments ou tous les nutriments, toujours pour 100 g.',
  policy: 'read',
  schema: lireAlimentsBanqueArgs,
  jsonSchema: {
    type: 'object',
    properties: {
      requete: { type: 'string' },
      categories: { type: 'array', items: { type: 'string', enum: foodCategories } },
      origines: { type: 'array', items: { type: 'string', enum: ['catalogue', 'ia', 'manuel'] } },
      aVerifier: { type: 'boolean' },
      nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } },
      detail: { type: 'string', enum: ['identite', 'nutriments', 'complet'] },
      offset: { type: 'integer', minimum: 0 },
      limite: { type: 'integer', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  run({ requete, categories, origines, aVerifier, nutriments, detail, offset, limite }) {
    const query = requete ? normalizeForMatch(requete) : '';
    const selected = nutriments?.length ? nutriments : nutrientKeys;
    const rows = effectiveFoods(useStore.getState().customFoods)
      .filter((food) => !query || [food.nom, ...food.aliases].some((name) => normalizeForMatch(name).includes(query)))
      .filter((food) => !categories?.length || categories.includes(food.categorie))
      .filter((food) => !origines?.length || origines.includes(food.origine ?? 'catalogue'))
      .filter((food) => aVerifier == null || !!food.aVerifier === aVerifier)
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const page = rows.slice(offset, offset + limite).map((food) => ({
      id: food.id,
      name: food.nom,
      aliases: food.aliases,
      category: food.categorie,
      source: food.origine ?? 'catalogue',
      needsReview: !!food.aVerifier,
      ...(detail === 'complet' ? { pieceGrams: food.pieceGrams ?? null, unitGrams: food.unitGrams ?? {} } : {}),
      ...(detail !== 'identite' ? {
        basis: 'pour 100 g',
        nutrients: selected.map((key) => ({
          key,
          label: nutrientMeta.get(key)?.label ?? nutrientLabelOf(key),
          unit: nutrientMeta.get(key)?.unit ?? '',
          value: round(food.n[key]),
        })),
      } : {}),
    }));
    return {
      scope: 'banque-personnelle',
      filters: { requete: requete ?? null, categories: categories ?? [], origines: origines ?? [], aVerifier: aVerifier ?? null },
      total: rows.length,
      offset,
      limit: limite,
      returned: page.length,
      hasMore: offset + page.length < rows.length,
      foods: page,
    };
  },
};

function datesBetween(debut: string, fin: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${debut}T12:00:00Z`);
  const end = new Date(`${fin}T12:00:00Z`);
  while (current <= end && dates.length < 3660) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

const qualiteArgs = validRange(rangeObject);
const lireQualiteDonnees: AgentTool<z.infer<typeof qualiteArgs>> = {
  name: 'lire_qualite_donnees',
  description: 'Mesure la complétude et les incertitudes du journal avant une analyse : jours absents, exclus, estimations et aliments non résolus.',
  policy: 'read',
  schema: qualiteArgs,
  jsonSchema: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' } }, required: ['debut', 'fin'], additionalProperties: false },
  run({ debut, fin }) {
    const s = useStore.getState();
    const dates = datesBetween(debut, fin);
    const entries = s.entries.filter((entry) => entry.date >= debut && entry.date <= fin);
    const filled = new Set(entries.map((entry) => entry.date));
    const items = entries.flatMap((entry) => entry.items);
    const counted = dates.filter((day) => isDayCounted(s.mutedDays, filled.has(day), day));
    return {
      period: { debut, fin, inclusive: true }, totalDays: dates.length, filledDays: filled.size,
      countedDays: counted.length, missingDays: dates.filter((day) => !filled.has(day) && s.mutedDays[day] !== false),
      excludedFilledDays: dates.filter((day) => filled.has(day) && !isDayCounted(s.mutedDays, true, day)),
      forcedFastingDays: dates.filter((day) => !filled.has(day) && s.mutedDays[day] === false),
      entryCount: entries.length, itemCount: items.length,
      estimatedItems: items.filter((item) => item.estimation || !!item.iaEstime).length,
      doubtfulItems: items.filter((item) => item.douteux).length,
      unresolvedItems: items.filter((item) => !item.foodId).length,
      filledDayCoveragePercent: dates.length ? round((filled.size / dates.length) * 100, 1) : 0,
    };
  },
};

const comparerArgs = z.object({
  periodeA: rangeObject,
  periodeB: rangeObject,
  nutriments: z.array(nutrientSchema).optional(),
  sansSupplements: z.boolean().default(false),
  inclureSoleil: z.boolean().default(true),
  inclurePoids: z.boolean().default(true),
}).refine((v) => v.periodeA.debut <= v.periodeA.fin && v.periodeB.debut <= v.periodeB.fin, 'Périodes invalides.');
const comparerPeriodes: AgentTool<z.infer<typeof comparerArgs>> = {
  name: 'comparer_periodes',
  description: 'Compare déterministement deux périodes pour des nutriments choisis et, si demandé, l’évolution du poids.',
  policy: 'read',
  schema: comparerArgs,
  jsonSchema: { type: 'object', properties: { periodeA: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' } }, required: ['debut', 'fin'] }, periodeB: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' } }, required: ['debut', 'fin'] }, nutriments: { type: 'array', items: { type: 'string', enum: nutrientKeys } }, sansSupplements: { type: 'boolean' }, inclureSoleil: { type: 'boolean' }, inclurePoids: { type: 'boolean' } }, required: ['periodeA', 'periodeB'], additionalProperties: false },
  async run({ periodeA, periodeB, nutriments, sansSupplements, inclureSoleil, inclurePoids }) {
    const options = { nutriments, sansSupplements: sansSupplements ?? false, inclureSoleil: inclureSoleil ?? true, ponderation: 'simple' as const, demiVieJours: DECAY_HALF_LIFE_DEFAULT, detail: 'resume' as const };
    const a = await moyenneNutriments.run({ ...periodeA, ...options }) as any;
    const b = await moyenneNutriments.run({ ...periodeB, ...options }) as any;
    const byKeyA = new Map((a.averages as any[]).map((row) => [row.key, row]));
    const nutrients = (b.averages as any[]).map((row) => {
      const before = byKeyA.get(row.key) as any;
      const valueA = before?.value ?? 0;
      const delta = round(row.value - valueA);
      return { key: row.key, label: row.label, unit: row.unit, valueA, valueB: row.value, delta, deltaPercent: valueA !== 0 ? round((delta / valueA) * 100, 1) : null };
    });
    const weightSummary = (range: { debut: string; fin: string }) => {
      const rows = useStore.getState().weightEntries.filter((entry) => entry.date >= range.debut && entry.date <= range.fin).sort((x, y) => `${x.date} ${x.heure}`.localeCompare(`${y.date} ${y.heure}`));
      return { count: rows.length, firstKg: rows[0]?.poids ?? null, lastKg: rows.at(-1)?.poids ?? null, changeKg: rows.length > 1 ? round(rows.at(-1)!.poids - rows[0].poids, 2) : null };
    };
    return { periodA: { ...periodeA, recordedDays: a.recordedDays }, periodB: { ...periodeB, recordedDays: b.recordedDays }, nutrients, ...(inclurePoids ?? true ? { weight: { periodA: weightSummary(periodeA), periodB: weightSummary(periodeB) } } : {}) };
  },
};

export const READ_TOOLS: AgentTool<unknown>[] = [lireRepas, lireNutriments, moyenneNutriments, lirePoids, lireSoleil, classerManquesExces, contributionsNutriment, frequencesAliments, lireProfilObjectifs, rechercherAlimentsBanque, lireAlimentsBanque, lireQualiteDonnees, comparerPeriodes] as AgentTool<unknown>[];
export const ALL_TOOLS: AgentTool<unknown>[] = [...READ_TOOLS, ...ACTION_TOOLS];

export function findTool(name: string): AgentTool<unknown> | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
