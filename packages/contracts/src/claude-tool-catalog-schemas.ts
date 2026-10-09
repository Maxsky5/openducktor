import { z } from "zod";
import { claudeBuiltinToolNameSchema } from "./claude-policy-schemas";

export const CLAUDE_RESERVED_TOOL_LIMITS: readonly {
  readonly name: string;
  readonly limitation: string;
}[] = Object.freeze([
  {
    name: "EndConversation",
    limitation: "Claude reserves EndConversation while other tools remain available.",
  },
]);

export const claudeToolCatalogInputSchema = z.strictObject({ runtimeId: z.string().min(1) });
export type ClaudeToolCatalogInput = z.infer<typeof claudeToolCatalogInputSchema>;
export const claudeToolCatalogSchema = z.strictObject({
  runtimeKind: z.literal("claude"),
  runtimeId: z.string().min(1),
  tools: z.array(
    z.strictObject({
      name: claudeBuiltinToolNameSchema,
      canDisable: z.boolean(),
      limitation: z.string().min(1).optional(),
    }),
  ),
});
export type ClaudeToolCatalog = z.infer<typeof claudeToolCatalogSchema>;
