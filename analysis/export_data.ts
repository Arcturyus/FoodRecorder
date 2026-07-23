/**
 * Exporte la banque d'aliments (TS) vers des CSV que le notebook Python lit.
 * À lancer depuis `web/` : `npx vite-node ../analysis/export_data.ts`
 *
 * Sorties :
 *  - analysis/data/foods.csv     : un aliment par ligne, valeurs POUR 100 g (brutes).
 *  - analysis/data/nutrients.csv : métadonnées par nutriment (libellé, unité, AJR,
 *                                  objectif, importance par défaut, famille).
 * Les normalisations (pour 100 kcal…) et la standardisation sont refaites DANS le
 * notebook — le but est de montrer chaque étape, pas de les pré-mâcher.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FOODS } from '../web/src/nutrition/foods';
import { RDA } from '../web/src/nutrition/rda';
import { NUTRIENT_GROUPS } from '../web/src/nutrition/groups';
import { DEFAULT_IMPORTANCE } from '../web/src/nutrition/recommend';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'data');
mkdirSync(outDir, { recursive: true });

const keys = RDA.map((r) => r.key); // inclut kcal (utile pour la base « pour 100 kcal »)

const groupOf = new Map<string, string>();
for (const g of NUTRIENT_GROUPS) for (const k of g.keys) groupOf.set(k, g.title);

function csv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

// foods.csv
const foodHeader = ['id', 'nom', 'categorie', ...keys];
const foodRows = FOODS.map((f) => [f.id, f.nom, f.categorie, ...keys.map((k) => f.n[k] ?? 0)]);
writeFileSync(join(outDir, 'foods.csv'), csv([foodHeader, ...foodRows]), 'utf8');

// nutrients.csv
const nutHeader = ['key', 'label', 'unit', 'rda', 'goal', 'importance', 'group'];
const nutRows = RDA.map((r) => [
  r.key,
  r.label,
  r.unit,
  r.rda,
  r.goal,
  DEFAULT_IMPORTANCE[r.key] ?? 1,
  groupOf.get(r.key) ?? 'Autres',
]);
writeFileSync(join(outDir, 'nutrients.csv'), csv([nutHeader, ...nutRows]), 'utf8');

console.log(`Exporté ${FOODS.length} aliments × ${keys.length} nutriments (dont kcal) → ${outDir}`);
