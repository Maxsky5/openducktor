import { z } from "zod";

export const slashCommandSourceValues = ["command", "mcp", "skill", "custom", "system"] as const;
export const slashCommandSourceSchema = z.enum(slashCommandSourceValues);
export type SlashCommandSource = z.infer<typeof slashCommandSourceSchema>;

const slashCommandTextSchema = z.string().trim().min(1);
const slashCommandTriggerSchema = slashCommandTextSchema.regex(/^[^/]+$/, {
  error: (issue) =>
    `Invalid slash command trigger ${JSON.stringify(issue.input)}: must contain no slashes`,
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

export const MANUAL_SESSION_COMPACTION_SLASH_COMMAND = {
  id: "system:compact",
  trigger: "compact",
  title: "Compact session",
  description: "Summarize the current session to reduce context size",
  source: "system",
  hints: [],
} as const satisfies SlashCommandDescriptor;

export const isManualSessionCompactionSlashCommand = (command: SlashCommandDescriptor): boolean =>
  command.id === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.id &&
  command.source === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.source &&
  command.trigger.toLowerCase() === MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger;

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
