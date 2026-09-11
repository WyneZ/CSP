import { z } from "zod";

export const createRequisitionSchema = z.object({
  siteId: z.string().uuid(),
  remarks: z.string().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        requestedQty: z.coerce.number().positive(),
      }),
    )
    .min(1),
});
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;

export const approveRequisitionSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        approvedQty: z.coerce.number().nonnegative(),
      }),
    )
    .min(1),
});
export type ApproveRequisitionInput = z.infer<typeof approveRequisitionSchema>;

export const rejectRequisitionSchema = z.object({
  reason: z.string().min(1),
});
export type RejectRequisitionInput = z.infer<typeof rejectRequisitionSchema>;

export const issueRequisitionSchema = z.object({
  // Phase A: one key per issue *attempt* (covers the whole multi-line
  // submit). The service derives a per-line key from this so each line's
  // StockMovement gets its own dedup identity — see requisitions.service.ts.
  idempotencyKey: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
      }),
    )
    .min(1),
});
export type IssueRequisitionInput = z.infer<typeof issueRequisitionSchema>;
