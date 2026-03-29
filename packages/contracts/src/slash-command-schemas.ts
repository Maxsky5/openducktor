import { z } from "zod";

export const slashCommandSourceValues = ["command", "mcp", "skill"] as const;
export const slashCommandSourceSchema = z.enum(slashCommandSourceValues);
export type SlashCommandSource = z.infer<typeof slashCommandSourceSchema>;

const slashCommandTextSchema = z.string().trim().min(1);
const slashCommandTriggerSchema = slashCommandTextSchema.regex(/^[^\s/]+$/, {
  message: "Trigger must be a single token without a leading slash",
});

export const slashCommandDescriptorSchema = z.object({
  id: slashCommandTextSchema,
  trigger: slashCommandTriggerSchema,
  title: slashCommandTextSchema,
  description: slashCommandTextSchema.optional(),
  source: slashCommandSourceSchema.optional(),
  hints: z.array(slashCommandTextSchema).default([]),
});
export type SlashCommandDescriptor = z.infer<typeof slashCommandDescriptorSchema>;

export const slashCommandCatalogSchema = z
  .object({
    commands: z.array(slashCommandDescriptorSchema),
  })
  .superRefine(({ commands }, ctx) => {
    const ids = new Set<string>();
    const triggers = new Set<string>();

    for (const [index, command] of commands.entries()) {
      if (ids.has(command.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commands", index, "id"],
          message: `Duplicate slash command id: ${command.id}`,
        });
      }
      ids.add(command.id);

      if (triggers.has(command.trigger)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commands", index, "trigger"],
          message: `Duplicate slash command trigger: ${command.trigger}`,
        });
      }
      triggers.add(command.trigger);
    }
  });
export type SlashCommandCatalog = z.infer<typeof slashCommandCatalogSchema>;
