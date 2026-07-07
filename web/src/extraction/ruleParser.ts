import type { ExtractedItem, Unit } from '../nutrition/types';
import { normalize } from '../nutrition/normalize';

/**
 * Parseur à règles pour le français oral.
 * Sert d'extracteur par défaut (rapide, hors-ligne) et de fallback si le LLM
 * n'est pas chargé ou échoue. Le LLM reste meilleur sur les formulations tordues.
 */

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
  huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
  quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50,
  soixante: 60, cent: 100, cents: 100, mille: 1000, quelques: 3,
};

/** Mots/expressions de remplissage à retirer avant le découpage. */
const FILLERS = [
  /\bj'ai (mange|pris|bu|avale)\b/g,
  /\b(je viens de manger|j'ai eu|on a mange|nous avons mange)\b/g,
  /\b(ce matin|ce midi|ce soir|cette nuit|hier soir|hier midi)\b/g,
  /\b(au petit dejeuner|au petit-dejeuner|au dejeuner|au diner|au gouter|en collation)\b/g,
  /\b(euh+|heu+|hum+|bah|ben|genre|voila|donc|alors|enfin|bref|quoi)\b/g,
  /\b(environ|a peu pres|je pense|je crois|je dirais|peut-etre|apres)\b/g,
  /\b(aussi|egalement|encore|ensuite)\b/g,
];

const SEGMENT_SPLIT = /\s*(?:,|;|\bet puis\b|\bpuis\b|\bet\b|\bavec\b|\bainsi que\b|\bplus\b)\s*/;

interface UnitPattern {
  regex: RegExp;
  unit: Unit;
  /** multiplicateur appliqué à la quantité (ex. cl → ml ×10) */
  factor?: number;
}

// Ordre important : les motifs les plus spécifiques d'abord.
const UNIT_WORDS: UnitPattern[] = [
  { regex: /^(?:kilos?|kilogrammes?|kg)$/, unit: 'g', factor: 1000 },
  { regex: /^(?:grammes?|gr?)$/, unit: 'g' },
  { regex: /^(?:millilitres?|ml)$/, unit: 'ml' },
  { regex: /^(?:centilitres?|cl)$/, unit: 'ml', factor: 10 },
  { regex: /^(?:litres?|l)$/, unit: 'ml', factor: 1000 },
  { regex: /^(?:bols?)$/, unit: 'bol' },
  { regex: /^(?:verres?)$/, unit: 'verre' },
  { regex: /^(?:assiettes?)$/, unit: 'assiette' },
  { regex: /^(?:tranches?)$/, unit: 'tranche' },
  { regex: /^(?:poignees?)$/, unit: 'poignee' },
  { regex: /^(?:carres?|carreaux?)$/, unit: 'carre' },
  { regex: /^(?:pots?)$/, unit: 'pot' },
  { regex: /^(?:portions?|parts?)$/, unit: 'portion' },
  { regex: /^(?:morceaux?|pieces?|boites?|canettes?|boules?)$/, unit: 'piece' },
];

/** "cuillere(s) a soupe/cafe" (2-3 mots) → cas/cac */
function matchSpoon(words: string[]): { unit: Unit; consumed: number } | null {
  if (!/^cuilleres?$/.test(words[0] ?? '')) {
    if (words[0] === 'cas') return { unit: 'cas', consumed: 1 };
    if (words[0] === 'cac') return { unit: 'cac', consumed: 1 };
    return null;
  }
  const rest = words.slice(1, 3).join(' ');
  if (/^(?:a )?soupe/.test(rest)) return { unit: 'cas', consumed: rest.startsWith('a ') ? 3 : 2 };
  if (/^(?:a )?cafe/.test(rest)) return { unit: 'cac', consumed: rest.startsWith('a ') ? 3 : 2 };
  return { unit: 'cas', consumed: 1 };
}

/** Parse une suite de mots-nombres ou chiffres en tête de liste. */
function parseNumber(words: string[]): { value: number; consumed: number } | null {
  let value = 0;
  let consumed = 0;
  let current = 0;
  for (const w of words) {
    const digit = w.match(/^(\d+(?:[.,]\d+)?)$/);
    if (digit) {
      current += parseFloat(digit[1].replace(',', '.'));
      consumed++;
      continue;
    }
    if (w === 'demi' || w === 'demie') {
      // "demi" seul ou "un demi" → 0,5 ; "deux demi(s)" est trop rare pour être géré
      current = current === 0 || current === 1 ? 0.5 : current + 0.5;
      consumed++;
      continue;
    }
    const n = NUMBER_WORDS[w];
    if (n === undefined) break;
    if ((n === 100 || n === 1000) && current > 0) current *= n;
    else current += n;
    consumed++;
  }
  value = current;
  if (consumed === 0 || value <= 0) return null;
  return { value, consumed };
}

function stripPartitive(s: string): string {
  return s.replace(/^(?:du |de la |de l'|des |le |la |les |l'|mon |ma |mes |quelques )/, '').trim();
}

function stripLinker(s: string): string {
  return s.replace(/^(?:de |d'|du |de la |de l'|des )/, '').trim();
}

function cleanFoodName(s: string): string {
  return s
    .replace(/\b(demi|petite?|grosse?|grande?|belle?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse un segment ("150 g de poulet", "une banane", "du riz"…) en item. */
function parseSegment(segment: string): ExtractedItem | null {
  const seg = segment.trim();
  if (!seg) return null;

  const words = seg.split(' ');
  const num = parseNumber(words);

  if (num) {
    const rest = words.slice(num.consumed);
    if (rest.length === 0) return null;

    // essaye une unité (1 à 3 mots)
    const spoon = matchSpoon(rest);
    let unit: Unit | null = null;
    let factor = 1;
    let unitConsumed = 0;
    if (spoon) {
      unit = spoon.unit;
      unitConsumed = spoon.consumed;
    } else {
      for (const up of UNIT_WORDS) {
        if (up.regex.test(rest[0])) {
          unit = up.unit;
          factor = up.factor ?? 1;
          unitConsumed = 1;
          break;
        }
      }
    }

    if (unit) {
      const aliment = cleanFoodName(stripLinker(rest.slice(unitConsumed).join(' ')));
      if (!aliment) return null;
      return { aliment, quantite: num.value * factor, unite: unit, estimation: false };
    }

    // "deux oeufs", "3 abricots" → pièces
    const aliment = cleanFoodName(stripLinker(rest.join(' ')));
    if (!aliment) return null;
    return { aliment, quantite: num.value, unite: 'piece', estimation: false };
  }

  // pas de quantité : "du riz", "de la salade", "yaourt" → portion estimée
  const aliment = cleanFoodName(stripPartitive(seg));
  if (!aliment || aliment.length < 2) return null;
  return { aliment, quantite: 1, unite: 'portion', estimation: true };
}

/** Extrait les items d'une phrase dictée en français. */
export function parseTranscript(text: string): ExtractedItem[] {
  let t = normalize(text);
  t = t.replace(/\bdemie?-/g, 'demi '); // "demi-baguette" → "demi baguette"
  for (const filler of FILLERS) t = t.replace(filler, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  const segments = t.split(SEGMENT_SPLIT);
  const items: ExtractedItem[] = [];
  for (const seg of segments) {
    const item = parseSegment(seg);
    if (item) items.push(item);
  }
  return items;
}
