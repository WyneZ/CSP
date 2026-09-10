import { z } from "zod";

export const createMaterialSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  unit: z.string().min(1),
  reorderLevel: z.coerce.number().nonnegative().optional(),
  standardRate: z.coerce.number().nonnegative().optional(),
  currency: z.string().optional(),
});
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = createMaterialSchema.partial();
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
