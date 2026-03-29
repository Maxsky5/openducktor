import { z } from "zod";

export const slashCommandSourceValues = ["command", "mcp", "skill"] as const;
export const slashCommandSourceSchema = z.enum(slashCommandSourceValues);
export type SlashCommandSource = z.infer<typeof slashCommandSourceSchema>;

const slashCommandTextSchema = z.string().trim().min(1);

export const slashCommandDescriptorSchema = z.object({
  id: slashCommandTextSchema,
  trigger: slashCommandTextSchema,
  title: slashCommandTextSchema,
  description: slashCommandTextSchema.optional(),
  source: slashCommandSourceSchema.optional(),
  hints: z.array(slashCommandTextSchema).default([]),
});
export type SlashCommandDescriptor = z.infer<typeof slashCommandDescriptorSchema>;

export const slashCommandCatalogSchema = z.object({
  commands: z.array(slashCommandDescriptorSchema),
});
export type SlashCommandCatalog = z.infer<typeof slashCommandCatalogSchema>;
