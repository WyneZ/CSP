import { z } from "zod";

export const createSiteSchema = z.object({
  name: z.string().min(1),
  client: z.string().optional(),
  location: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = createSiteSchema.partial().extend({
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
});
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
