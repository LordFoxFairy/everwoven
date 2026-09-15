import {z} from 'zod';
import {videoSuppliers, videoModels, type SupplierId, type ModelId} from 'runtime/contracts/video-deployments';

// Wire data only. Never expose a credential, file path or Prisma record here.
export const videoConfigurationSchema = z.object({
  available: z.boolean(),
  selection: z.object({
    providerId: z.enum(Object.keys(videoSuppliers) as SupplierId[]),
    modelId: z.enum(Object.keys(videoModels) as ModelId[]),
  }).strict().nullable(),
  reason: z.enum(['ready', 'unselected', 'unsupported', 'not-live', 'disabled', 'missing-key']),
}).strict();
export type VideoConfiguration = z.infer<typeof videoConfigurationSchema>;
