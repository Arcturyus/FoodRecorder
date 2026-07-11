/**
 * Export / import des données (sauvegarde hors localStorage).
 *  - JSON : sauvegarde complète ré-importable (journal, pesées, aliments perso,
 *    overrides, favoris, profil, constantes). La clé API n'est PAS exportée.
 *  - CSV : exports lisibles (tableur) du journal et des pesées — lecture seule.
 */

import { useStore, todayStr } from './store';
import type { JournalEntry, FavoriteMeal, FoodOverrides } from './store';
import type { Food } from '../nutrition/types';
import type { Profile } from '../nutrition/targets';
import type { WeightEntry, WeightConfig } from '../weight/types';
import { WEIGHT_METRICS } from '../weight/types';
import type { SunExposure } from '../sun/vitaminD';

export interface BackupData {
  app: 'foodrecorder';
  version: 1;
  exportedAt: string; // ISO
  entries: JournalEntry[];
  customFoods: Food[];
  foodOverrides: FoodOverrides;
  favoriteMeals: FavoriteMeal[];
  profile: Profile;
  weightEntries: WeightEntry[];
  weightConfig: WeightConfig;
  /** Absent des sauvegardes antérieures à la fonctionnalité (import tolérant). */
  sunExposures?: SunExposure[];
}

/** Construit l'objet de sauvegarde depuis l'état courant du store. */
export function buildBackup(): BackupData {
  const s = useStore.getState();
  return {
    app: 'foodrecorder',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: s.entries,
    customFoods: s.customFoods,
    foodOverrides: s.foodOverrides,
    favoriteMeals: s.favoriteMeals,
    profile: s.profile,
    weightEntries: s.weightEntries,
    weightConfig: s.weightConfig,
    sunExposures: s.sunExposures,
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
  useStore.setState({
    entries: b.entries,
    customFoods: b.customFoods ?? [],
    foodOverrides: b.foodOverrides ?? {},
    favoriteMeals: b.favoriteMeals ?? [],
    ...(b.profile ? { profile: b.profile } : {}),
    weightEntries: b.weightEntries,
    ...(b.weightConfig ? { weightConfig: b.weightConfig } : {}),
    sunExposures: b.sunExposures ?? [],
  });
  const days = new Set(b.entries.map((e) => e.date)).size;
  return `Import réussi : ${b.entries.length} entrée(s) sur ${days} jour(s), ${b.weightEntries.length} pesée(s), ${
    (b.customFoods ?? []).length
  } aliment(s) perso, ${(b.favoriteMeals ?? []).length} repas favori(s).`;
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
