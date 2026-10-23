import type { Food, Unit } from './types';
import type { QuantityChoice } from './quantitySuggestion';
import { stripAccents } from './normalize';

export interface QuickFoodQuery {
  foodQuery: string;
  quantity?: number;
  unit?: Unit;
  /** Numeric suffix with an unknown unit: search still works, dose stays unchanged. */
  uncertain?: boolean;
}

const UNIT_ALIASES: [RegExp, Unit, number][] = [
  [/^(g|gr|grammes?)$/, 'g', 1], [/^(kg|kilos?|kilogrammes?)$/, 'g', 1000],
  [/^(mg|milligrammes?)$/, 'mg', 1], [/^(µg|μg|ug|mcg|microgrammes?)$/, 'µg', 1],
  [/^(ml|millilitres?)$/, 'ml', 1], [/^(cl|centilitres?)$/, 'ml', 10], [/^(l|litres?)$/, 'ml', 1000],
  [/^pieces?$/, 'piece', 1], [/^portions?$/, 'portion', 1], [/^tranches?$/, 'tranche', 1],
  [/^pots?$/, 'pot', 1], [/^verres?$/, 'verre', 1], [/^bols?$/, 'bol', 1],
  [/^doses?$/, 'dose', 1], [/^poignees?$/, 'poignee', 1], [/^carres?$/, 'carre', 1],
  [/^pincees?$/, 'pincee', 1], [/^(cas|c\. ?a soupe|cuilleres? a soupe)$/, 'cas', 1],
  [/^(cac|c\. ?a cafe|cuilleres? a cafe)$/, 'cac', 1],
];

/** Deliberately a single food and one numeric quantity, never a free-form meal parser.
 * Only a separate leading/trailing numeric token can be a dose (B12 and 0% stay names). */
export function parseQuickFoodQuery(raw: string): QuickFoodQuery {
  const text = raw.trim();
  const suffix = text.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-ZÀ-ÿµμ. ]*)$/u);
  const prefix = text.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-ZÀ-ÿµμ.]*)\s+(.+)$/u);
  if (!suffix && !prefix) return { foodQuery: text };
  const foodQuery = (suffix ? suffix[1] : prefix![3]).trim().replace(/^de\s+/i, '');
  const number = Number((suffix ? suffix[2] : prefix![1]).replace(',', '.'));
  const token = stripAccents((suffix ? suffix[3] : prefix![2]).trim().toLowerCase());
  // Multiple numbers, signs or food connectors mean the intent is not a single dose.
  if (!foodQuery || /\b\d|[+;,]|\b(et|avec)\b/i.test(foodQuery) || /[-+]\s*$/.test(foodQuery)) return { foodQuery: text };
  const alias = UNIT_ALIASES.find(([pattern]) => pattern.test(token));
  if ((token && !alias) || !(number > 0) || !Number.isFinite(number)) return { foodQuery, uncertain: true };
  const quantity = number * (alias?.[2] ?? 1);
  return Number.isFinite(quantity) ? { foodQuery, quantity, ...(alias ? { unit: alias[1] } : {}) } : { foodQuery, uncertain: true };
}

/** A bare number may reuse a reliable unit; large unitless piece counts are ambiguous. */
export function quickQuantity(query: QuickFoodQuery, food: Food, remembered: QuantityChoice | null): QuantityChoice | null {
  if (query.quantity == null) return null;
  if (query.unit) return { quantite: query.quantity, unite: query.unit };
  const unite = remembered?.unite ?? (food.pieceGrams ? 'piece' : null);
  if (!unite || (unite !== 'g' && unite !== 'mg' && unite !== 'µg' && unite !== 'ml' && query.quantity > 10)) return null;
  return { quantite: query.quantity, unite };
}
