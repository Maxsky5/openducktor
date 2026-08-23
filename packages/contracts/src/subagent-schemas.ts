import { z } from "zod";
import { exactOptionalSchema } from "./exact-optional";

const subagentTextSchema = z.string().trim().min(1);

export const subagentDescriptorSchema = exactOptionalSchema(
  z
    .object({
      id: subagentTextSchema,
      name: subagentTextSchema,
      label: subagentTextSchema.optional(),
      description: subagentTextSchema.optional(),
    })
    .strict(),
);
export type SubagentDescriptor = z.infer<typeof subagentDescriptorSchema>;

export const subagentCatalogSchema = z
  .object({
    subagents: z.array(subagentDescriptorSchema),
  })
  .superRefine(({ subagents }, ctx) => {
    const ids = new Set<string>();

    for (const [index, subagent] of subagents.entries()) {
      if (ids.has(subagent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subagents", index, "id"],
          message: `Duplicate subagent id: ${subagent.id}`,
        });
      }
      ids.add(subagent.id);
    }
  });
export type SubagentCatalog = z.infer<typeof subagentCatalogSchema>;
