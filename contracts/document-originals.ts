import { z } from 'zod';

export const documentOriginalLimits = { fileBytes: 12_000_000, memoryBytes: 48_000_000, persistentBytes: 128_000_000, pendingMilliseconds: 300_000 } as const;
export const documentOriginalSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(5).max(documentOriginalLimits.fileBytes),
  mimeType: z.literal('application/pdf'),
}).strict();
export type DocumentOriginal = z.infer<typeof documentOriginalSchema>;
