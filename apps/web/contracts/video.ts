import {z} from 'zod';

// Wire data only. Never expose a credential, file path or Prisma record here.
export const videoConfigurationSchema = z.object({
  available: z.boolean(),
  selection: z.object({
    providerId: z.enum(['minimax', 'fal']),
    modelId: z.enum(['minimax-h3', 'minimax-h3-max', 'h3-max-director']),
  }).strict().nullable(),
  reason: z.enum(['ready', 'unselected', 'unsupported', 'not-live', 'disabled', 'missing-key']),
}).strict();
export type VideoConfiguration = z.infer<typeof videoConfigurationSchema>;
