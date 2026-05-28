import { z } from "zod";

const skillTextSchema = z.string().trim().min(1);

export const skillDescriptorSchema = z.object({
  id: skillTextSchema,
  name: skillTextSchema,
  path: skillTextSchema,
  title: skillTextSchema.optional(),
  displayName: skillTextSchema.optional(),
  description: skillTextSchema.optional(),
  color: skillTextSchema.optional(),
});
export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;

export const skillCatalogSchema = z
  .object({
    skills: z.array(skillDescriptorSchema),
  })
  .superRefine(({ skills }, ctx) => {
    const ids = new Set<string>();

    for (const [index, skill] of skills.entries()) {
      if (ids.has(skill.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skills", index, "id"],
          message: `Duplicate skill id: ${skill.id}`,
        });
      }
      ids.add(skill.id);
    }
  });
export type SkillCatalog = z.infer<typeof skillCatalogSchema>;
