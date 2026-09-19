import { z } from "zod";
import { agentModelCatalogSchema } from "./agent-engine-schemas";
import { runtimeDescriptorSchema } from "./agent-runtime-schemas";
import { runtimeWorkingDirectoryRefSchema } from "./agent-session-schemas";
import { skillCatalogSchema } from "./skill-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";
import { subagentCatalogSchema } from "./subagent-schemas";

export type AgentRuntimeCatalogSurface<Catalog> =
  | { status: "available"; catalog: Catalog }
  | { status: "failed"; message: string };

export const agentRuntimeCatalogSurfaceNameValues = [
  "models",
  "slashCommands",
  "skills",
  "subagents",
] as const;
export const agentRuntimeCatalogSurfaceNameSchema = z.enum(agentRuntimeCatalogSurfaceNameValues);
export type AgentRuntimeCatalogSurfaceName = z.infer<typeof agentRuntimeCatalogSurfaceNameSchema>;

export const agentRuntimeLoadCatalogInputSchema = runtimeWorkingDirectoryRefSchema
  .extend({
    surfaces: z.array(agentRuntimeCatalogSurfaceNameSchema).nonempty().optional(),
  })
  .strict();
export type AgentRuntimeLoadCatalogInput = z.infer<typeof agentRuntimeLoadCatalogInputSchema>;

export const agentRuntimeCatalogSchema = z
  .object({
    runtime: runtimeDescriptorSchema.optional(),
    models: catalogSurfaceSchema(agentModelCatalogSchema).optional(),
    slashCommands: catalogSurfaceSchema(slashCommandCatalogSchema).optional(),
    skills: catalogSurfaceSchema(skillCatalogSchema).optional(),
    subagents: catalogSurfaceSchema(subagentCatalogSchema).optional(),
  })
  .strict();
export type AgentRuntimeCatalog = z.infer<typeof agentRuntimeCatalogSchema>;

function catalogSurfaceSchema<CatalogSchema extends z.ZodType>(catalogSchema: CatalogSchema) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), catalog: catalogSchema }).strict(),
    z.object({ status: z.literal("failed"), message: z.string().trim().min(1) }).strict(),
  ]);
}
