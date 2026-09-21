import { z } from 'zod';
import { EMPTY_NUTRIENTS, UNITS, type ExtractedItem, type Food, type FoodCategory, type NutrientKey } from '../nutrition/types';
import { RDA, nutrientLabelOf } from '../nutrition/rda';
import { normalizeForMatch } from '../nutrition/normalize';
import type { Profile, TargetOverride } from '../nutrition/targets';
import { AGENT_SECTIONS, AGENT_TABS, useNavigation } from './navigation';
import { isDayCounted, resyncEntries, useStore } from '../store/store';
import type { AgentActionPlan, AgentActionPreviewGroup, AgentActivity, AgentTool } from './protocol';

const ACTIVITY_KEY = 'foodrecorder-agent-activity';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const date = z.string().regex(DATE_RE, 'Date attendue au format YYYY-MM-DD');
const time = z.string().regex(TIME_RE, 'Heure attendue au format HH:MM');
const units = z.enum(UNITS);
const nutrientKeys = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];
const foodCategories = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const satisfies readonly FoodCategory[];
const foodCategorySchema = z.enum(foodCategories);
const nutrientMeta = new Map(RDA.map((row) => [row.key, { label: row.label, unit: row.unit }]));

function stable(value: unknown): string { return JSON.stringify(value); }
function plan(tool: string, args: unknown, preview: string, impact: string, precondition: unknown, undoable = true, changes?: AgentActionPreviewGroup[]): AgentActionPlan {
  return { id: crypto.randomUUID(), tool, args, preview, impact, precondition: stable(precondition), undoable, ...(changes?.length ? { changes } : {}) };
}

export function readAgentActivity(): AgentActivity[] {
  if (typeof localStorage === 'undefined') return [];
  try { const parsed = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function writeActivity(entry: AgentActivity) {
  if (typeof localStorage === 'undefined') return;
  const next = [entry, ...readAgentActivity()].slice(0, 200);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('foodrecorder-agent-activity'));
}

export function recordRefusal(p: AgentActionPlan) {
  writeActivity({ id: p.id, at: Date.now(), tool: p.tool, args: p.args, preview: p.preview, status: 'refused', undoable: false });
}

const mealArgs = z.object({
  date,
  transcript: z.string().trim().max(500).default('Ajout via agent'),
  aliments: z.array(z.object({ aliment: z.string().trim().min(1), quantite: z.number().positive(), unite: units })).min(1).max(30),
});

const weightArgs = z.object({
  date, heure: time, poids: z.number().positive().max(500), aJeun: z.boolean().default(false), nu: z.boolean().default(false),
  masseGrasse: z.number().min(0).max(100).optional(), eau: z.number().min(0).max(100).optional(),
  masseMusculaire: z.number().min(0).max(100).optional(), masseOsseuse: z.number().min(0).max(20).optional(),
  graisseViscerale: z.number().min(0).max(100).optional(), metabolismeBasalMachine: z.number().min(0).max(10000).optional(),
  remarque: z.string().max(500).optional(),
});

const sunArgs = z.object({
  date, heure: time, dureeMin: z.number().int().min(1).max(720),
  ciel: z.enum(['tres-ensoleille', 'ensoleille', 'voile', 'nuageux', 'couvert']),
  peau: z.enum(['visage-mains', 'visage-bras', 'bras-jambes', 'torse-nu']),
  phenotype: z.enum(['blanc', 'bronze', 'mat', 'noir']), creme: z.enum(['aucune', 'visage', 'complete']),
});

const noteArgs = z.object({ date, note: z.string().max(3000) });
const navigateArgs = z.object({ onglet: z.enum(AGENT_TABS), date: date.optional(), section: z.enum(AGENT_SECTIONS).optional() });
const targetArgs = z.object({ nutriment: z.enum(nutrientKeys as [NutrientKey, ...NutrientKey[]]), ajr: z.number().min(0).optional(), optimal: z.number().min(0).optional(), perKg: z.boolean().optional() }).refine((v) => v.ajr != null || v.optimal != null || v.perKg != null, 'Au moins un réglage est requis.');
const profileArgs = z.object({ sexe: z.enum(['homme', 'femme']).optional(), poids: z.number().positive().max(500).optional(), activite: z.enum(['sedentaire', 'modere', 'sportif', 'intense']).optional(), objectif: z.enum(['maintien', 'perte', 'muscle']).optional(), deficitPct: z.number().min(0).max(50).optional(), surplusPct: z.number().min(0).max(50).optional(), protParKg: z.number().min(0).max(10).optional() }).refine((v) => Object.keys(v).length > 0, 'Au moins un champ est requis.');
const aliasesSchema = z.array(z.string().trim().min(1).max(120)).max(50);
const foodModification = z.object({
  id: z.string().min(1),
  nom: z.string().trim().min(1).optional(),
  /** Replaces the complete alias list, so removing an alias is unambiguous. */
  aliases: aliasesSchema.optional(),
  categorie: foodCategorySchema.optional(),
  pieceGrams: z.number().positive().optional(),
  nutriments: z.record(z.enum(nutrientKeys as [NutrientKey, ...NutrientKey[]]), z.number().min(0)).optional(),
}).superRefine((value, ctx) => {
  if (value.nom == null && value.aliases == null && value.categorie == null && value.pieceGrams == null && value.nutriments == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Au moins une correction est requise.' });
  }
  if (value.aliases && new Set(value.aliases.map(normalizeForMatch)).size !== value.aliases.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Les alias doivent être uniques.', path: ['aliases'] });
  }
});
const editFoodArgs = foodModification;
const editFoodsArgs = z.object({
  modifications: z.array(foodModification).min(1).max(100),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.modifications.forEach((item, index) => {
    if (seen.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Identifiant dupliqué : ${item.id}`, path: ['modifications', index, 'id'] });
    seen.add(item.id);
  });
});
const mergeArgs = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).refine((v) => v.sourceId !== v.targetId, 'Les deux aliments doivent être différents.');
const resyncArgs = z.object({ confirmerToutesLesEntrees: z.literal(true) });
const deleteArgs = z.object({ id: z.string().min(1) });
const modifyMealArgs = z.object({
  id: z.string().min(1),
  date: date.optional(),
  aliments: z.array(z.object({ id: z.string().min(1), nom: z.string().trim().min(1).optional(), quantite: z.number().positive().optional(), unite: units.optional() }).refine((v) => v.nom != null || v.quantite != null || v.unite != null, 'Une correction est requise.')).max(30).optional(),
}).refine((v) => v.date != null || !!v.aliments?.length, 'Au moins une correction est requise.');
const modifyWeightArgs = z.object({
  id: z.string().min(1), date: date.optional(), heure: time.optional(), poids: z.number().positive().max(500).optional(),
  aJeun: z.boolean().optional(), nu: z.boolean().optional(), masseGrasse: z.number().min(0).max(100).optional(), eau: z.number().min(0).max(100).optional(),
  masseMusculaire: z.number().min(0).max(100).optional(), masseOsseuse: z.number().min(0).max(20).optional(), graisseViscerale: z.number().min(0).max(100).optional(),
  metabolismeBasalMachine: z.number().min(0).max(10000).optional(), remarque: z.string().max(500).optional(),
}).refine((v) => Object.keys(v).some((key) => key !== 'id'), 'Au moins une correction est requise.');
const modifySunArgs = sunArgs.partial().extend({ id: z.string().min(1) }).refine((v) => Object.keys(v).some((key) => key !== 'id'), 'Au moins une correction est requise.');
const countedDayArgs = z.object({ date, compte: z.boolean() });

type FoodModification = z.infer<typeof foodModification>;

const completeNutrients = z.object(Object.fromEntries(
  nutrientKeys.map((key) => [key, z.number().min(0)]),
) as Record<NutrientKey, z.ZodNumber>);
const foodCreation = z.object({
  nom: z.string().trim().min(1).max(120),
  aliases: aliasesSchema.default([]),
  categorie: foodCategorySchema,
  pieceGrams: z.number().positive().optional(),
  unitGrams: z.record(units, z.number().positive()).optional(),
  nutriments: completeNutrients,
}).superRefine((value, ctx) => {
  const names = [value.nom, ...value.aliases].map(normalizeForMatch);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Le nom et les alias doivent être distincts.', path: ['aliases'] });
});
const createFoodArgs = foodCreation;
type FoodCreation = z.input<typeof foodCreation>;
const completeNutrientsJsonSchema = {
  type: 'object',
  properties: Object.fromEntries(nutrientKeys.map((key) => [key, { type: 'number', minimum: 0 }])),
  required: nutrientKeys,
  additionalProperties: false,
};

function foodChanges(modifications: FoodModification[]): AgentActionPreviewGroup[] {
  const bank = useStore.getState().customFoods;
  return modifications.map((change) => {
    const food = bank.find((row) => row.id === change.id);
    if (!food) throw new Error(`Aliment introuvable : ${change.id}.`);
    const fields: AgentActionPreviewGroup['fields'] = [];
    if (change.nom != null && change.nom !== food.nom) fields.push({ key: 'nom', label: 'Nom', before: food.nom, after: change.nom });
    if (change.aliases != null && stable(change.aliases) !== stable(food.aliases)) fields.push({ key: 'aliases', label: 'Alias', before: food.aliases.join(', ') || '—', after: change.aliases.join(', ') || '—' });
    if (change.categorie != null && change.categorie !== food.categorie) fields.push({ key: 'categorie', label: 'Catégorie', before: food.categorie, after: change.categorie });
    if (change.pieceGrams != null && change.pieceGrams !== food.pieceGrams) fields.push({ key: 'pieceGrams', label: 'Poids par pièce', before: food.pieceGrams ?? null, after: change.pieceGrams, unit: 'g' });
    for (const [key, after] of Object.entries(change.nutriments ?? {}) as [NutrientKey, number][]) {
      if (food.n[key] === after) continue;
      const meta = nutrientMeta.get(key);
      fields.push({ key, label: meta?.label ?? nutrientLabelOf(key), before: food.n[key], after, unit: `${meta?.unit ?? ''}/100 g` });
    }
    return { id: food.id, label: food.nom, fields };
  }).filter((group) => group.fields.length > 0);
}

function applyFoodModifications(modifications: FoodModification[]): Food[] {
  const ids = new Set(modifications.map((row) => row.id));
  const byId = new Map(modifications.map((row) => [row.id, row]));
  const current = useStore.getState();
  for (const id of ids) if (!current.customFoods.some((food) => food.id === id)) throw new Error(`Aliment introuvable : ${id}.`);
  let changedFoods: Food[] = [];
  useStore.setState((state) => {
    const customFoods = state.customFoods.map((food) => {
      const change = byId.get(food.id);
      if (!change) return food;
      const next: Food = {
        ...food,
        ...(change.nom != null ? { nom: change.nom } : {}),
        ...(change.aliases != null ? { aliases: change.aliases } : {}),
        ...(change.categorie != null ? { categorie: change.categorie } : {}),
        ...(change.pieceGrams != null ? { pieceGrams: change.pieceGrams } : {}),
        n: { ...food.n, ...(change.nutriments ?? {}) },
        // Un patch partiel (comme un reclassement) ne prouve pas que toute la
        // fiche a été relue : le statut global « à vérifier » est conservé.
      };
      changedFoods.push(next);
      return next;
    });
    return { customFoods, entries: resyncEntries(state.entries, customFoods) };
  });
  return changedFoods;
}

function createBankFood(creation: FoodCreation): Food {
  const current = useStore.getState();
  const occupiedNames = new Set(current.customFoods.flatMap((food) => [food.nom, ...food.aliases]).map(normalizeForMatch));
  for (const name of [creation.nom, ...(creation.aliases ?? [])]) {
    if (occupiedNames.has(normalizeForMatch(name))) throw new Error(`Le nom ou alias « ${name} » est déjà utilisé par une fiche existante.`);
  }
  const food: Food = {
    id: `custom-${crypto.randomUUID()}`,
    nom: creation.nom,
    aliases: creation.aliases ?? [],
    categorie: creation.categorie,
    ...(creation.pieceGrams != null ? { pieceGrams: creation.pieceGrams } : {}),
    ...(creation.unitGrams != null ? { unitGrams: creation.unitGrams } : {}),
    n: creation.nutriments,
    custom: true,
    origine: 'ia',
    aVerifier: true,
    ajouteLe: new Date().toISOString().slice(0, 10),
  };
  useStore.setState((state) => ({ customFoods: [food, ...state.customFoods] }));
  return food;
}

function foodCreationChanges(food: FoodCreation): AgentActionPreviewGroup[] {
  return [{
    id: 'new-food',
    label: food.nom,
    fields: [
      { key: 'nom', label: 'Nom', before: null, after: food.nom },
      { key: 'aliases', label: 'Alias', before: null, after: (food.aliases ?? []).join(', ') || '—' },
      { key: 'categorie', label: 'Catégorie', before: null, after: food.categorie },
      ...(food.pieceGrams != null ? [{ key: 'pieceGrams', label: 'Poids par pièce', before: null, after: food.pieceGrams, unit: 'g' }] : []),
      ...nutrientKeys.map((key) => {
        const meta = nutrientMeta.get(key);
        return { key, label: meta?.label ?? nutrientLabelOf(key), before: null, after: food.nutriments[key], unit: `${meta?.unit ?? ''}/100 g` };
      }),
    ],
  }];
}

function dataFingerprint(tool: string, args: any): unknown {
  const s = useStore.getState();
  switch (tool) {
    case 'ajouter_repas': return { count: s.entries.length, bank: s.customFoods.length };
    case 'ajouter_pesee': return { count: s.weightEntries.length, profileWeight: s.profile.poids };
    case 'ajouter_soleil': return { count: s.sunExposures.length };
    case 'noter_jour': return { note: s.dayNotes[args.date] ?? '' };
    case 'modifier_objectif_nutriment': return s.nutrientTargets[args.nutriment as NutrientKey] ?? null;
    case 'modifier_profil': return Object.fromEntries(Object.keys(args).map((key) => [key, (s.profile as any)[key] ?? null]));
    case 'modifier_aliment_global': return s.customFoods.find((f) => f.id === args.id) ?? null;
    case 'modifier_aliments_banque': return args.modifications.map((change: FoodModification) => s.customFoods.find((f) => f.id === change.id) ?? null);
    case 'creer_aliment_banque': return stable(s.customFoods);
    case 'fusionner_aliments': return { source: s.customFoods.find((f) => f.id === args.sourceId) ?? null, target: s.customFoods.find((f) => f.id === args.targetId) ?? null, entryCount: s.entries.length };
    case 'resynchroniser_historique': return { foods: stable(s.customFoods), entries: stable(s.entries) };
    case 'modifier_repas':
    case 'supprimer_repas': return s.entries.find((entry) => entry.id === args.id) ?? null;
    case 'modifier_pesee':
    case 'supprimer_pesee': return { entry: s.weightEntries.find((entry) => entry.id === args.id) ?? null, profileWeight: s.profile.poids };
    case 'modifier_soleil':
    case 'supprimer_soleil': return s.sunExposures.find((entry) => entry.id === args.id) ?? null;
    case 'regler_jour_compte': return { override: Object.prototype.hasOwnProperty.call(s.mutedDays, args.date) ? s.mutedDays[args.date] : null, hasEntries: s.entries.some((entry) => entry.date === args.date) };
    default: return null;
  }
}

export async function executeAction(p: AgentActionPlan): Promise<{ content: unknown; activity: AgentActivity }> {
  if (stable(dataFingerprint(p.tool, p.args)) !== p.precondition) {
    const activity: AgentActivity = { id: p.id, at: Date.now(), tool: p.tool, args: p.args, preview: p.preview, status: 'conflict', error: 'Les données ont changé depuis l’aperçu.', undoable: false };
    writeActivity(activity); throw new Error(activity.error);
  }
  const s = useStore.getState(); const args: any = p.args; let result: unknown; let createdIds: string[] = []; let preimage: unknown;
  try {
    if (p.tool === 'ajouter_repas') {
      const items: ExtractedItem[] = args.aliments.map((x: any) => ({ ...x, estimation: false }));
      const id = s.addEntry(args.transcript, items, 'manuel', args.date); createdIds = [id]; result = { entryId: id, entry: useStore.getState().entries.find((e) => e.id === id) };
    } else if (p.tool === 'ajouter_pesee') {
      preimage = { profileWeight: s.profile.poids }; const id = s.addWeightEntry({ ...args, source: 'manuel' }); createdIds = [id]; result = { weightId: id, entry: useStore.getState().weightEntries.find((e) => e.id === id), profileWeight: useStore.getState().profile.poids };
    } else if (p.tool === 'ajouter_soleil') {
      const id = s.addSunExposure(args); createdIds = [id]; result = { sunExposureId: id, exposure: useStore.getState().sunExposures.find((e) => e.id === id) };
    } else if (p.tool === 'noter_jour') {
      preimage = { note: s.dayNotes[args.date] ?? '' }; s.setDayNote(args.date, args.note); result = { date: args.date, note: args.note.trim() };
    } else if (p.tool === 'modifier_objectif_nutriment') {
      preimage = s.nutrientTargets[args.nutriment as NutrientKey] ?? null; const { nutriment, ...patch } = args; s.setNutrientTarget(nutriment as NutrientKey, patch); result = { nutriment, target: useStore.getState().nutrientTargets[nutriment as NutrientKey] };
    } else if (p.tool === 'modifier_profil') {
      preimage = Object.fromEntries(Object.keys(args).map((key) => [key, (s.profile as any)[key]])); s.setProfile(args); result = { profile: useStore.getState().profile };
    } else if (p.tool === 'modifier_aliment_global') {
      const food = s.customFoods.find((f) => f.id === args.id); if (!food) throw new Error('Aliment introuvable.'); preimage = food;
      const [changed] = applyFoodModifications([args]); result = { food: changed };
    } else if (p.tool === 'modifier_aliments_banque') {
      preimage = args.modifications.map((change: FoodModification) => s.customFoods.find((food) => food.id === change.id));
      const foods = applyFoodModifications(args.modifications); result = { foods, modifiedCount: foods.length };
    } else if (p.tool === 'creer_aliment_banque') {
      const food = createBankFood(args); createdIds = [food.id]; result = { food };
    } else if (p.tool === 'fusionner_aliments') {
      preimage = dataFingerprint(p.tool, args); const count = s.mergeFoods(args.sourceId, args.targetId); result = { itemsRepointes: count };
    } else if (p.tool === 'resynchroniser_historique') {
      const count = s.resyncHistory(); result = { entriesRecalculees: count };
    } else if (p.tool === 'modifier_repas') {
      const entry = s.entries.find((row) => row.id === args.id); if (!entry) throw new Error('Repas introuvable.'); preimage = entry;
      for (const itemPatch of args.aliments ?? []) if (!entry.items.some((item) => item.id === itemPatch.id)) throw new Error(`Aliment de repas introuvable : ${itemPatch.id}.`);
      if (args.date && args.date !== entry.date) s.moveEntry(args.id, args.date);
      for (const itemPatch of args.aliments ?? []) {
        const current = useStore.getState().entries.find((row) => row.id === args.id)?.items.find((item) => item.id === itemPatch.id);
        if (!current) continue;
        if (itemPatch.nom && itemPatch.nom !== current.nomAffiche) s.renameItem(args.id, itemPatch.id, itemPatch.nom);
        if (itemPatch.quantite != null || itemPatch.unite != null) s.updateItem(args.id, itemPatch.id, { ...(itemPatch.quantite != null ? { quantite: itemPatch.quantite } : {}), ...(itemPatch.unite != null ? { unite: itemPatch.unite } : {}) });
      }
      result = { entry: useStore.getState().entries.find((row) => row.id === args.id) };
    } else if (p.tool === 'supprimer_repas') {
      const entry = s.entries.find((row) => row.id === args.id); if (!entry) throw new Error('Repas introuvable.'); preimage = entry; s.removeEntry(args.id); result = { removed: true, entryId: args.id };
    } else if (p.tool === 'modifier_pesee') {
      const entry = s.weightEntries.find((row) => row.id === args.id); if (!entry) throw new Error('Pesée introuvable.'); preimage = { entry, profileWeight: s.profile.poids };
      const { id, ...patch } = args; s.updateWeightEntry(id, patch); result = { entry: useStore.getState().weightEntries.find((row) => row.id === id), profileWeight: useStore.getState().profile.poids };
    } else if (p.tool === 'supprimer_pesee') {
      const entry = s.weightEntries.find((row) => row.id === args.id); if (!entry) throw new Error('Pesée introuvable.'); preimage = { entry, profileWeight: s.profile.poids }; s.removeWeightEntry(args.id); result = { removed: true, weightId: args.id, profileWeight: useStore.getState().profile.poids };
    } else if (p.tool === 'modifier_soleil') {
      const exposure = s.sunExposures.find((row) => row.id === args.id); if (!exposure) throw new Error('Exposition introuvable.'); preimage = exposure;
      const { id, ...patch } = args; s.updateSunExposure(id, patch); result = { exposure: useStore.getState().sunExposures.find((row) => row.id === id) };
    } else if (p.tool === 'supprimer_soleil') {
      const exposure = s.sunExposures.find((row) => row.id === args.id); if (!exposure) throw new Error('Exposition introuvable.'); preimage = exposure; s.removeSunExposure(args.id); result = { removed: true, exposureId: args.id };
    } else if (p.tool === 'regler_jour_compte') {
      preimage = { hadOverride: Object.prototype.hasOwnProperty.call(s.mutedDays, args.date), override: s.mutedDays[args.date] };
      s.setDayMute(args.date, !args.compte); result = { date: args.date, counted: args.compte, override: useStore.getState().mutedDays[args.date] ?? null };
    } else throw new Error(`Action inconnue : ${p.tool}`);
    const activity: AgentActivity = { id: p.id, at: Date.now(), tool: p.tool, args: p.args, preview: p.preview, status: 'confirmed', result, createdIds, preimage, undoable: p.undoable };
    writeActivity(activity); return { content: result, activity };
  } catch (error) {
    const activity: AgentActivity = { id: p.id, at: Date.now(), tool: p.tool, args: p.args, preview: p.preview, status: 'error', error: error instanceof Error ? error.message : String(error), undoable: false };
    writeActivity(activity); throw error;
  }
}

export function undoActivity(id: string): { ok: boolean; message: string } {
  const all = readAgentActivity(); const a = all.find((x) => x.id === id); if (!a || a.status !== 'confirmed' || !a.undoable) return { ok: false, message: 'Cette action n’est pas annulable.' };
  const s = useStore.getState(); const args: any = a.args; const created = a.createdIds?.[0]; let safe = false;
  if (a.tool === 'ajouter_repas' && created) { safe = stable(s.entries.find((e) => e.id === created)) === stable((a.result as any)?.entry); if (safe) s.removeEntry(created); }
  else if (a.tool === 'ajouter_pesee' && created) { safe = stable(s.weightEntries.find((e) => e.id === created)) === stable((a.result as any)?.entry) && s.profile.poids === (a.result as any)?.profileWeight; if (safe) { s.removeWeightEntry(created); s.setProfile({ poids: (a.preimage as any).profileWeight }); } }
  else if (a.tool === 'ajouter_soleil' && created) { safe = stable(s.sunExposures.find((e) => e.id === created)) === stable((a.result as any)?.exposure); if (safe) s.removeSunExposure(created); }
  else if (a.tool === 'noter_jour') { safe = (s.dayNotes[args.date] ?? '') === args.note.trim(); if (safe) s.setDayNote(args.date, (a.preimage as any).note); }
  else if (a.tool === 'modifier_objectif_nutriment') { safe = stable(s.nutrientTargets[args.nutriment as NutrientKey]) === stable((a.result as any)?.target); const old = a.preimage as TargetOverride | null; if (safe) old ? s.setNutrientTarget(args.nutriment, old) : s.resetNutrientTarget(args.nutriment); }
  else if (a.tool === 'modifier_profil') { safe = Object.keys(args).every((k) => (s.profile as any)[k] === args[k]); if (safe) s.setProfile(a.preimage as Partial<Profile>); }
  else if (a.tool === 'modifier_aliment_global') {
    safe = stable(s.customFoods.find((f) => f.id === args.id)) === stable((a.result as any)?.food);
    if (safe) useStore.setState((state) => {
      const customFoods = state.customFoods.map((food) => food.id === args.id ? a.preimage as Food : food);
      return { customFoods, entries: resyncEntries(state.entries, customFoods) };
    });
  }
  else if (a.tool === 'modifier_aliments_banque') {
    const resultFoods = (a.result as any)?.foods as Food[] | undefined;
    safe = !!resultFoods && resultFoods.every((food) => stable(s.customFoods.find((row) => row.id === food.id)) === stable(food));
    if (safe) {
      const previous = new Map((a.preimage as Food[]).map((food) => [food.id, food]));
      useStore.setState((state) => {
        const customFoods = state.customFoods.map((food) => previous.get(food.id) ?? food);
        return { customFoods, entries: resyncEntries(state.entries, customFoods) };
      });
    }
  }
  else if (a.tool === 'creer_aliment_banque') {
    const createdFood = (a.result as any)?.food as Food | undefined;
    safe = !!createdFood && stable(s.customFoods.find((row) => row.id === createdFood.id)) === stable(createdFood);
    if (safe && createdFood) useStore.setState((state) => ({ customFoods: state.customFoods.filter((food) => food.id !== createdFood.id) }));
  }
  else if (a.tool === 'modifier_repas') {
    safe = stable(s.entries.find((entry) => entry.id === args.id)) === stable((a.result as any)?.entry);
    if (safe) useStore.setState((state) => ({ entries: state.entries.map((entry) => entry.id === args.id ? a.preimage as any : entry) }));
  }
  else if (a.tool === 'supprimer_repas') {
    safe = !s.entries.some((entry) => entry.id === args.id);
    if (safe) useStore.setState((state) => ({ entries: [a.preimage as any, ...state.entries] }));
  }
  else if (a.tool === 'modifier_pesee') {
    safe = stable(s.weightEntries.find((entry) => entry.id === args.id)) === stable((a.result as any)?.entry) && s.profile.poids === (a.result as any)?.profileWeight;
    if (safe) useStore.setState((state) => ({ weightEntries: state.weightEntries.map((entry) => entry.id === args.id ? (a.preimage as any).entry : entry), profile: { ...state.profile, poids: (a.preimage as any).profileWeight } }));
  }
  else if (a.tool === 'supprimer_pesee') {
    safe = !s.weightEntries.some((entry) => entry.id === args.id) && s.profile.poids === (a.result as any)?.profileWeight;
    if (safe) useStore.setState((state) => ({ weightEntries: [(a.preimage as any).entry, ...state.weightEntries], profile: { ...state.profile, poids: (a.preimage as any).profileWeight } }));
  }
  else if (a.tool === 'modifier_soleil') {
    safe = stable(s.sunExposures.find((entry) => entry.id === args.id)) === stable((a.result as any)?.exposure);
    if (safe) useStore.setState((state) => ({ sunExposures: state.sunExposures.map((entry) => entry.id === args.id ? a.preimage as any : entry) }));
  }
  else if (a.tool === 'supprimer_soleil') {
    safe = !s.sunExposures.some((entry) => entry.id === args.id);
    if (safe) useStore.setState((state) => ({ sunExposures: [a.preimage as any, ...state.sunExposures] }));
  }
  else if (a.tool === 'regler_jour_compte') {
    safe = isDayCounted(s.mutedDays, s.entries.some((entry) => entry.date === args.date), args.date) === args.compte;
    if (safe) useStore.setState((state) => { const mutedDays = { ...state.mutedDays }; if ((a.preimage as any).hadOverride) mutedDays[args.date] = (a.preimage as any).override; else delete mutedDays[args.date]; return { mutedDays }; });
  }
  if (!safe) {
    const message = 'Conflit : la donnée a changé depuis l’action, annulation refusée.';
    const updated = all.map((x) => x.id === id ? { ...x, status: 'conflict' as const, error: message, undoable: false } : x);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('foodrecorder-agent-activity'));
    return { ok: false, message };
  }
  const updated = all.map((x) => x.id === id ? { ...x, status: 'undone' as const, undoable: false } : x); localStorage.setItem(ACTIVITY_KEY, JSON.stringify(updated)); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('foodrecorder-agent-activity'));
  return { ok: true, message: 'Action annulée.' };
}

function confirmedTool<T>(name: string, description: string, schema: z.ZodType<T>, jsonSchema: Record<string, unknown>, preview: (args: T) => { text: string; impact: string; undoable?: boolean; changes?: AgentActionPreviewGroup[] }): AgentTool<T> {
  return { name, description, schema, jsonSchema, policy: 'confirm', run: () => { throw new Error('Confirmation requise.'); }, prepare: (args) => { const p = preview(args); return plan(name, args, p.text, p.impact, dataFingerprint(name, args), p.undoable ?? true, p.changes); } };
}

const naviguer: AgentTool<z.infer<typeof navigateArgs>> = { name: 'naviguer', description: 'Ouvre un onglet, une date ou une section autorisée de FoodRecorder.', schema: navigateArgs, jsonSchema: { type: 'object', properties: { onglet: { type: 'string', enum: AGENT_TABS }, date: { type: 'string' }, section: { type: 'string', enum: AGENT_SECTIONS } }, required: ['onglet'], additionalProperties: false }, policy: 'navigate', run: (args) => { useNavigation.getState().go(args.onglet, { date: args.date, section: args.section }); return { navigated: true, ...args }; } };

export const ACTION_TOOLS: AgentTool<unknown>[] = [
  naviguer,
  confirmedTool('ajouter_repas', 'Prépare l’ajout d’un repas. Exige toujours une confirmation.', mealArgs, { type: 'object', properties: { date: { type: 'string' }, transcript: { type: 'string' }, aliments: { type: 'array', items: { type: 'object', properties: { aliment: { type: 'string' }, quantite: { type: 'number' }, unite: { type: 'string', enum: UNITS } }, required: ['aliment', 'quantite', 'unite'], additionalProperties: false } } }, required: ['date', 'aliments'], additionalProperties: false }, (a) => ({ text: `Ajouter ${a.aliments.map((x) => `${x.quantite} ${x.unite} de ${x.aliment}`).join(', ')} le ${a.date}.`, impact: `1 entrée, ${a.aliments.length} aliment(s).` })),
  confirmedTool('ajouter_pesee', 'Prépare l’ajout d’une pesée. Exige toujours une confirmation.', weightArgs, { type: 'object', properties: { date: { type: 'string' }, heure: { type: 'string' }, poids: { type: 'number' }, aJeun: { type: 'boolean' }, nu: { type: 'boolean' } }, required: ['date', 'heure', 'poids'], additionalProperties: true }, (a) => ({ text: `Ajouter une pesée de ${a.poids} kg le ${a.date} à ${a.heure}.`, impact: '1 pesée ; le poids courant du profil sera mis à jour.' })),
  confirmedTool('ajouter_soleil', 'Prépare l’ajout d’une exposition solaire. Exige toujours une confirmation.', sunArgs, { type: 'object', properties: { date: { type: 'string' }, heure: { type: 'string' }, dureeMin: { type: 'integer' }, ciel: { type: 'string' }, peau: { type: 'string' }, phenotype: { type: 'string' }, creme: { type: 'string' } }, required: ['date', 'heure', 'dureeMin', 'ciel', 'peau', 'phenotype', 'creme'], additionalProperties: false }, (a) => ({ text: `Ajouter ${a.dureeMin} min de soleil le ${a.date} à ${a.heure}.`, impact: '1 exposition solaire.' })),
  confirmedTool('modifier_repas', 'Corrige la date, le nom ou la quantité d’aliments d’une entrée de repas existante.', modifyMealArgs, { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, aliments: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nom: { type: 'string' }, quantite: { type: 'number' }, unite: { type: 'string', enum: UNITS } }, required: ['id'], additionalProperties: false } } }, required: ['id'], additionalProperties: false }, (a) => ({ text: `Corriger l’entrée de repas ${a.id}${a.date ? ` et la déplacer au ${a.date}` : ''}.`, impact: `${a.aliments?.length ?? 0} aliment(s) corrigé(s).` })),
  confirmedTool('supprimer_repas', 'Supprime une entrée de repas complète.', deleteArgs, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, (a) => { const entry = useStore.getState().entries.find((row) => row.id === a.id); return { text: `Supprimer l’entrée ${a.id}${entry ? ` du ${entry.date}` : ''}.`, impact: `${entry?.items.length ?? 0} aliment(s) supprimé(s).` }; }),
  confirmedTool('modifier_pesee', 'Corrige une pesée existante.', modifyWeightArgs, { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, heure: { type: 'string' }, poids: { type: 'number' }, aJeun: { type: 'boolean' }, nu: { type: 'boolean' }, masseGrasse: { type: 'number' }, eau: { type: 'number' }, masseMusculaire: { type: 'number' }, masseOsseuse: { type: 'number' }, graisseViscerale: { type: 'number' }, metabolismeBasalMachine: { type: 'number' }, remarque: { type: 'string' } }, required: ['id'], additionalProperties: false }, (a) => ({ text: `Corriger la pesée ${a.id} : ${Object.entries(a).filter(([key]) => key !== 'id').map(([key, value]) => `${key}=${value}`).join(', ')}.`, impact: '1 pesée ; le poids courant du profil peut être recalculé.' })),
  confirmedTool('supprimer_pesee', 'Supprime une pesée existante.', deleteArgs, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, (a) => { const entry = useStore.getState().weightEntries.find((row) => row.id === a.id); return { text: `Supprimer la pesée ${a.id}${entry ? ` de ${entry.poids} kg du ${entry.date}` : ''}.`, impact: '1 pesée supprimée.' }; }),
  confirmedTool('modifier_soleil', 'Corrige une exposition solaire existante.', modifySunArgs, { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, heure: { type: 'string' }, dureeMin: { type: 'integer' }, ciel: { type: 'string' }, peau: { type: 'string' }, phenotype: { type: 'string' }, creme: { type: 'string' } }, required: ['id'], additionalProperties: false }, (a) => ({ text: `Corriger l’exposition solaire ${a.id} : ${Object.entries(a).filter(([key]) => key !== 'id').map(([key, value]) => `${key}=${value}`).join(', ')}.`, impact: '1 exposition ; les estimations de vitamine D concernées seront recalculées.' })),
  confirmedTool('supprimer_soleil', 'Supprime une exposition solaire existante.', deleteArgs, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, (a) => { const entry = useStore.getState().sunExposures.find((row) => row.id === a.id); return { text: `Supprimer l’exposition ${a.id}${entry ? ` du ${entry.date}` : ''}.`, impact: '1 exposition et sa contribution estimée en vitamine D supprimées.' }; }),
  confirmedTool('regler_jour_compte', 'Inclut ou exclut explicitement un jour des moyennes, y compris un jour vide considéré comme jeûne.', countedDayArgs, { type: 'object', properties: { date: { type: 'string' }, compte: { type: 'boolean' } }, required: ['date', 'compte'], additionalProperties: false }, (a) => ({ text: `${a.compte ? 'Inclure' : 'Exclure'} le ${a.date} dans les moyennes.`, impact: 'Toutes les moyennes et comparaisons couvrant ce jour seront recalculées.' })),
  confirmedTool('noter_jour', 'Prépare l’ajout ou le remplacement de la note d’un jour.', noteArgs, { type: 'object', properties: { date: { type: 'string' }, note: { type: 'string' } }, required: ['date', 'note'], additionalProperties: false }, (a) => ({ text: `${a.note.trim() ? 'Remplacer' : 'Effacer'} la note du ${a.date}${a.note.trim() ? ` par « ${a.note.trim()} »` : ''}.`, impact: '1 note de jour.' })),
  confirmedTool('modifier_objectif_nutriment', 'Modifie globalement une cible nutritionnelle.', targetArgs, { type: 'object', properties: { nutriment: { type: 'string', enum: nutrientKeys }, ajr: { type: 'number' }, optimal: { type: 'number' }, perKg: { type: 'boolean' } }, required: ['nutriment'], additionalProperties: false }, (a) => ({ text: `Modifier la cible globale ${RDA.find((r) => r.key === a.nutriment)?.label ?? a.nutriment}.`, impact: 'Tous les bilans, couvertures et recommandations futurs utilisant cette cible.' })),
  confirmedTool('modifier_profil', 'Modifie des champs du profil personnel.', profileArgs, { type: 'object', properties: { sexe: { type: 'string' }, poids: { type: 'number' }, activite: { type: 'string' }, objectif: { type: 'string' }, deficitPct: { type: 'number' }, surplusPct: { type: 'number' }, protParKg: { type: 'number' } }, additionalProperties: false }, (a) => ({ text: `Modifier le profil : ${Object.entries(a).map(([k, v]) => `${k}=${v}`).join(', ')}.`, impact: 'Recalcul global des objectifs et recommandations dépendant du profil.' })),
  confirmedTool('modifier_aliment_global', 'Modifie le nom, les alias, la catégorie, le poids par pièce ou certains nutriments d’une fiche. Le champ aliases remplace toute la liste, ce qui permet une suppression explicite. Les nutriments non fournis restent strictement inchangés.', editFoodArgs, { type: 'object', properties: { id: { type: 'string' }, nom: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, categorie: { type: 'string', enum: foodCategories }, pieceGrams: { type: 'number' }, nutriments: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } } }, required: ['id'], additionalProperties: false }, (a) => {
    const changes = foodChanges([a]);
    if (!changes.length) throw new Error('Aucune modification effective.');
    const s = useStore.getState(); const n = s.entries.flatMap((e) => e.items).filter((i) => i.foodId === a.id).length;
    return { text: `Modifier la fiche ${changes[0].label}.`, impact: `${changes[0].fields.length} champ(s) ; ${n} item(s) d’historique seront recalculés.`, changes };
  }),
  confirmedTool('modifier_aliments_banque', 'Modifie atomiquement jusqu’à 100 aliments déjà adoptés : nom, alias, catégorie et/ou valeurs nutritionnelles partielles. aliases remplace la liste complète, pour pouvoir retirer des synonymes. Une seule confirmation affiche tous les avant/après ; soit tout est appliqué, soit rien.', editFoodsArgs, { type: 'object', properties: { modifications: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { id: { type: 'string' }, nom: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, categorie: { type: 'string', enum: foodCategories }, pieceGrams: { type: 'number' }, nutriments: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } } }, required: ['id'], additionalProperties: false } } }, required: ['modifications'], additionalProperties: false }, (a) => {
    const changes = foodChanges(a.modifications);
    if (!changes.length) throw new Error('Aucune modification effective.');
    const ids = new Set(changes.map((row) => row.id));
    const historyItems = useStore.getState().entries.flatMap((entry) => entry.items).filter((item) => item.foodId && ids.has(item.foodId)).length;
    const fieldCount = changes.reduce((sum, group) => sum + group.fields.length, 0);
    return { text: `Modifier ${changes.length} aliment(s) de la banque en une seule opération.`, impact: `${fieldCount} champ(s) ; ${historyItems} item(s) d’historique seront recalculés.`, changes };
  }),
  confirmedTool('creer_aliment_banque', 'Crée une fiche alimentaire estimée par l’agent dans la banque personnelle. Évalue les nutriments pour 100 g, même lorsque l’utilisateur ne les donne pas tous ; les valeurs fournies servent d’indications à vérifier, pas d’instructions à recopier. La fiche reste marquée à vérifier. Le nom et les alias ne doivent pas déjà exister.', createFoodArgs, { type: 'object', properties: { nom: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, categorie: { type: 'string', enum: foodCategories }, pieceGrams: { type: 'number', exclusiveMinimum: 0 }, unitGrams: { type: 'object', additionalProperties: { type: 'number', exclusiveMinimum: 0 } }, nutriments: completeNutrientsJsonSchema }, required: ['nom', 'categorie', 'nutriments'], additionalProperties: false }, (a) => {
    const changes = foodCreationChanges(a);
    return { text: `Créer la fiche ${a.nom} dans la banque.`, impact: '1 fiche estimée et marquée à vérifier sera ajoutée sans modifier l’historique existant.', changes };
  }),
  confirmedTool('fusionner_aliments', 'Fusionne deux aliments et repointe tout l’historique.', mergeArgs, { type: 'object', properties: { sourceId: { type: 'string' }, targetId: { type: 'string' } }, required: ['sourceId', 'targetId'], additionalProperties: false }, (a) => { const s = useStore.getState(); const n = s.entries.flatMap((e) => e.items).filter((i) => i.foodId === a.sourceId).length; return { text: `Fusionner ${a.sourceId} dans ${a.targetId}.`, impact: `${n} item(s) repointés ; la fiche source sera supprimée.`, undoable: false }; }),
  confirmedTool('resynchroniser_historique', 'Recalcule tout l’historique depuis la banque actuelle.', resyncArgs, { type: 'object', properties: { confirmerToutesLesEntrees: { const: true } }, required: ['confirmerToutesLesEntrees'], additionalProperties: false }, () => ({ text: 'Recalculer toutes les entrées depuis les fiches actuelles de la banque.', impact: `${useStore.getState().entries.length} entrée(s) potentiellement touchée(s).`, undoable: false })),
] as AgentTool<unknown>[];
