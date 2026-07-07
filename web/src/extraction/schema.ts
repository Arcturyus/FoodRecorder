import { z } from 'zod';
import { UNITS } from '../nutrition/types';
import type { ExtractedItem } from '../nutrition/types';

export const extractedItemSchema = z.object({
  aliment: z.string().min(1),
  quantite: z.number().positive(),
  unite: z.enum(UNITS),
  estimation: z.boolean(),
});

export const extractionSchema = z.object({
  items: z.array(extractedItemSchema),
});

export type Extraction = z.infer<typeof extractionSchema>;

/** JSON Schema équivalent, pour le décodage contraint de WebLLM. */
export const extractionJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          aliment: { type: 'string' },
          quantite: { type: 'number' },
          unite: { type: 'string', enum: [...UNITS] },
          estimation: { type: 'boolean' },
        },
        required: ['aliment', 'quantite', 'unite', 'estimation'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export function validateExtraction(raw: unknown): ExtractedItem[] | null {
  const parsed = extractionSchema.safeParse(raw);
  return parsed.success ? parsed.data.items : null;
}
