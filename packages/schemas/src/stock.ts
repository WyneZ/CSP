import { z } from "zod";

export const createReceiptSchema = z.object({
  siteId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  remarks: z.string().optional(),
});
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const createIssueSchema = z.object({
  siteId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  remarks: z.string().optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
