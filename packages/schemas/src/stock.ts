import { z } from "zod";

export const createReceiptSchema = z.object({
  siteId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  remarks: z.string().optional(),
  // Phase A: client-generated per-attempt key. Same key resubmitted ==
  // same logical write; a resubmit with a fresh key is a new write.
  idempotencyKey: z.string().uuid().optional(),
});
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const createIssueSchema = z.object({
  siteId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  remarks: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
