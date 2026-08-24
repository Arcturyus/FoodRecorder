/**
 * Export / import des données (sauvegarde hors localStorage).
 *  - JSON : sauvegarde complète ré-importable (journal, pesées, aliments perso,
 *    overrides, favoris, profil, constantes). La clé API n'est PAS exportée.
 *  - CSV : exports lisibles (tableur) du journal et des pesées — lecture seule.
 */

import { useStore, todayStr, resyncEntries, effectiveFoods, normalizeNutrients, BANK_SCHEMA_VERSION } from './store';
import type { JournalEntry, FavoriteMeal, FoodOverrides, SttEngine, ExtractionMode } from './store';
import { migrateToPersonalBank } from '../nutrition/bank';
import type { Food } from '../nutrition/types';
import type { Profile, TargetOverrides } from '../nutrition/targets';
import type { WeightEntry, WeightConfig } from '../weight/types';
import { WEIGHT_METRICS } from '../weight/types';
import type { SunExposure } from '../sun/vitaminD';
import type { NutrientKey } from '../nutrition/types';
import { backupCounts } from './backupCounts';

/**
 * Réglages de l'appareil (moteur d'extraction, modèles). Sauvegardés pour ne pas
 * avoir à les refaire après une restauration ; la clé API en est volontairement
 * exclue (secret, propre à l'appareil).
 */
export interface BackupSettings {
  sttEngine: SttEngine;
  sttModel: string;
  llmModel: string;
  extractionMode: ExtractionMode;
  cloudModel: string;
}

export interface BackupData {
  app: 'foodrecorder';
  /** 1 = catalogue en dur + overrides ; 2 = banque personnelle (migrée à l'import). */
  version: 1 | 2;
  exportedAt: string; // ISO
  entries: JournalEntry[];
  /** Ma banque d'aliments (cf. `AppState.customFoods`). */
  customFoods: Food[];
  /** ANCIEN modèle (version 1) : lu à l'import pour la migration, plus jamais écrit. */
  foodOverrides?: FoodOverrides;
  favoriteMeals: FavoriteMeal[];
  profile: Profile;
  weightEntries: WeightEntry[];
  weightConfig: WeightConfig;
  /** Absent des sauvegardes antérieures à la fonctionnalité (import tolérant). */
  sunExposures?: SunExposure[];
  /** Jours exclus des moyennes / forcés comptés (jeûne). Absent des vieilles sauvegardes. */
  mutedDays?: Record<string, boolean>;
  /** Notes libres par jour. Absent des vieilles sauvegardes. */
  dayNotes?: Record<string, string>;
  /** Overrides d'importance des nutriments. Absent des vieilles sauvegardes. */
  nutrientImportance?: Partial<Record<NutrientKey, number>>;
  /** Cibles (AJR / optimal) réglées à la main. Absent des vieilles sauvegardes. */
  nutrientTargets?: TargetOverrides;
  /** Réglages d'extraction / dictée (hors clé API). Absent des vieilles sauvegardes. */
  settings?: BackupSettings;
}

/** Construit l'objet de sauvegarde depuis l'état courant du store. */
export function buildBackup(): BackupData {
  const s = useStore.getState();
  return {
    app: 'foodrecorder',
    version: BANK_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    entries: s.entries,
    customFoods: s.customFoods,
    favoriteMeals: s.favoriteMeals,
    profile: s.profile,
    weightEntries: s.weightEntries,
    weightConfig: s.weightConfig,
    sunExposures: s.sunExposures,
    mutedDays: s.mutedDays,
    dayNotes: s.dayNotes,
    nutrientImportance: s.nutrientImportance,
    nutrientTargets: s.nutrientTargets,
    settings: {
      sttEngine: s.sttEngine,
      sttModel: s.sttModel,
      llmModel: s.llmModel,
      extractionMode: s.extractionMode,
      cloudModel: s.cloudModel,
    },
  };
}


/**
 * Valide puis applique une sauvegarde JSON (remplace les données actuelles).
 * Retourne un résumé lisible, ou lève une erreur si le fichier est invalide.
 */
export function importBackup(text: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Fichier illisible : ce n’est pas du JSON valide.');
  }
  const b = raw as Partial<BackupData>;
  if (b.app !== 'foodrecorder' || !Array.isArray(b.entries) || !Array.isArray(b.weightEntries)) {
    throw new Error('Ce fichier ne ressemble pas à une sauvegarde FoodRecorder.');
  }
  // Recalcul depuis la base ACTUELLE, exactement comme à l'hydratation
  // (mergePersisted) : une sauvegarde est par nature plus vieille que le code
  // qui la relit. Sans ça, un nutriment ajouté depuis (la répartition des AG
  // saturés, hier les oméga 3 détaillés) reste absent des items importés — et
  // ressort en « NaN » ou en 0 dans le bilan jusqu'au prochain rechargement.
  const stored = (b.customFoods ?? []).map((food) => ({ ...food, n: normalizeNutrients(food.n) }));
  const favoriteMeals = b.favoriteMeals ?? [];
  // Sauvegarde d'avant la banque personnelle : on la migre au vol, exactement
  // comme à l'hydratation. Les aliments du catalogue qu'elle référence sont
  // recopiés dans la banque, et ses estimations IA deviennent des aliments.
  const migrated =
    (b.version ?? 1) >= BANK_SCHEMA_VERSION
      ? { customFoods: stored, entries: b.entries }
      : migrateToPersonalBank({
          entries: b.entries,
          customFoods: stored,
          foodOverrides: b.foodOverrides ?? {},
          favoriteMeals,
        });
  const customFoods = migrated.customFoods;
  useStore.setState({
    entries: resyncEntries(migrated.entries, effectiveFoods(customFoods)),
    customFoods,
    bankSchemaVersion: BANK_SCHEMA_VERSION,
    favoriteMeals,
    ...(b.profile ? { profile: b.profile } : {}),
    weightEntries: b.weightEntries,
    ...(b.weightConfig ? { weightConfig: b.weightConfig } : {}),
    sunExposures: b.sunExposures ?? [],
    mutedDays: b.mutedDays ?? {},
    dayNotes: b.dayNotes ?? {},
    nutrientImportance: b.nutrientImportance ?? {},
    nutrientTargets: b.nutrientTargets ?? {},
    // Champ par champ (et non `...b.settings`) : un fichier bricolé ne doit pas
    // pouvoir injecter n'importe quelle clé dans le store.
    ...(b.settings
      ? {
          ...(b.settings.sttEngine ? { sttEngine: b.settings.sttEngine } : {}),
          ...(b.settings.sttModel ? { sttModel: b.settings.sttModel } : {}),
          ...(b.settings.llmModel ? { llmModel: b.settings.llmModel } : {}),
          ...(b.settings.extractionMode ? { extractionMode: b.settings.extractionMode } : {}),
          ...(b.settings.cloudModel ? { cloudModel: b.settings.cloudModel } : {}),
        }
      : {}),
  });
  const days = new Set(b.entries.map((e) => e.date)).size;
  const c = backupCounts(b as Record<string, unknown>);
  // Tout ce qui se restaure est annoncé : c'est le seul moyen de vérifier d'un
  // coup d'œil qu'une donnée (notes, jours non comptés…) a bien fait le voyage.
  const extras: [number, string][] = [
    [c.soleil, 'sortie(s) au soleil'],
    [c.notes, 'note(s) de jour'],
    [c['jours réglés'], 'jour(s) comptés / non comptés réglés'],
    [c.importances, 'importance(s) de nutriment réglée(s)'],
  ];
  const extraText = extras.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return (
    `Import réussi : ${b.entries.length} entrée(s) sur ${days} jour(s), ${b.weightEntries.length} pesée(s), ` +
    `${c['aliments perso']} aliment(s) perso, ${c.favoris} repas favori(s)` +
    (extraText.length > 0 ? `, ${extraText.join(', ')}` : '') +
    '.'
  );
}

// ---------------------------------------------------------------------------
// CSV (séparateur « ; » pour Excel/LibreOffice FR)
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  // BOM UTF-8 pour qu'Excel affiche correctement les accents.
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

/** Journal alimentaire : une ligne par aliment consommé. */
export function journalToCsv(entries: JournalEntry[]): string {
  const rows: unknown[][] = [
    ['date', 'heure', 'aliment', 'quantite', 'unite', 'grammes', 'kcal', 'proteines_g', 'glucides_g', 'lipides_g', 'source', 'phrase'],
  ];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  for (const e of sorted) {
    const heure = new Date(e.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    for (const it of e.items) {
      rows.push([
        e.date,
        heure,
        it.nomAffiche,
        it.quantite,
        it.unite,
        Math.round(it.grams),
        Math.round(it.nutrients.kcal),
        it.nutrients.proteines.toFixed(1),
        it.nutrients.glucides.toFixed(1),
        it.nutrients.lipides.toFixed(1),
        e.source,
        e.transcript,
      ]);
    }
  }
  return toCsv(rows);
}

/** Pesées : une ligne par mesure, mêmes colonnes que le CSV de la balance. */
export function weightsToCsv(entries: WeightEntry[]): string {
  const rows: unknown[][] = [
    ['date', 'heure', 'a_jeun', 'nu', ...WEIGHT_METRICS.map((mt) => mt.key), 'remarque'],
  ];
  const sorted = [...entries].sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`));
  for (const e of sorted) {
    rows.push([
      e.date,
      e.heure,
      e.aJeun ? 'oui' : 'non',
      e.nu ? 'oui' : 'non',
      ...WEIGHT_METRICS.map((mt) => e[mt.key] ?? ''),
      e.remarque ?? '',
    ]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------------
// Téléchargement navigateur
// ---------------------------------------------------------------------------

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportJsonFile(): void {
  downloadFile(`foodrecorder-sauvegarde-${todayStr()}.json`, JSON.stringify(buildBackup(), null, 2), 'application/json');
}

export function exportJournalCsvFile(): void {
  downloadFile(`foodrecorder-journal-${todayStr()}.csv`, journalToCsv(useStore.getState().entries), 'text/csv');
}

export function exportWeightsCsvFile(): void {
  downloadFile(`foodrecorder-pesees-${todayStr()}.csv`, weightsToCsv(useStore.getState().weightEntries), 'text/csv');
}
