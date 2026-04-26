import { z } from "zod";
import type { AgentRole, AgentToolName } from "./agent-workflow-schemas";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "./odt-tool-names";

export const knownRuntimeKindValues = ["opencode"] as const;
export const knownRuntimeKindSchema = z.enum(knownRuntimeKindValues);
export type KnownRuntimeKind = z.infer<typeof knownRuntimeKindSchema>;

export const runtimeKindSchema = z.string().trim().min(1);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const runtimeProvisioningModeSchema = z.enum(["host_managed", "external"]);
export type RuntimeProvisioningMode = z.infer<typeof runtimeProvisioningModeSchema>;

export const runtimeSupportedScopeValues = ["workspace", "task", "build"] as const;
export const runtimeSupportedScopeSchema = z.enum(runtimeSupportedScopeValues);
export type RuntimeSupportedScope = z.infer<typeof runtimeSupportedScopeSchema>;

export const runtimeSupportedScopesSchema = z
  .array(runtimeSupportedScopeSchema)
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: "Supported runtime scopes must be unique.",
  });

export const runtimeSubagentExecutionModeValues = ["foreground", "background"] as const;
export const runtimeSubagentExecutionModeSchema = z.enum(runtimeSubagentExecutionModeValues);
export type RuntimeSubagentExecutionMode = z.infer<typeof runtimeSubagentExecutionModeSchema>;

export const runtimeSupportedSubagentExecutionModesSchema = z
  .array(runtimeSubagentExecutionModeSchema)
  .refine((modes) => new Set(modes).size === modes.length, {
    message: "Supported subagent execution modes must be unique.",
  });

export const runtimeCapabilitiesSchema = z
  .object({
    supportsProfiles: z.boolean(),
    supportsVariants: z.boolean(),
    supportsSlashCommands: z.boolean(),
    supportsFileSearch: z.boolean(),
    supportsOdtWorkflowTools: z.boolean(),
    supportsSessionFork: z.boolean(),
    supportsQueuedUserMessages: z.boolean(),
    supportsPermissionRequests: z.boolean(),
    supportsQuestionRequests: z.boolean(),
    supportsTodos: z.boolean(),
    supportsDiff: z.boolean(),
    supportsFileStatus: z.boolean(),
    supportsMcpStatus: z.boolean(),
    supportsSubagents: z.boolean(),
    supportedSubagentExecutionModes: runtimeSupportedSubagentExecutionModesSchema,
    supportedScopes: runtimeSupportedScopesSchema,
    provisioningMode: runtimeProvisioningModeSchema,
  })
  .superRefine((capabilities, context) => {
    if (
      capabilities.supportsSubagents &&
      capabilities.supportedSubagentExecutionModes.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["supportedSubagentExecutionModes"],
        message:
          "Runtime descriptors that support subagents must declare at least one supported subagent execution mode.",
      });
    }

    if (
      !capabilities.supportsSubagents &&
      capabilities.supportedSubagentExecutionModes.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["supportedSubagentExecutionModes"],
        message:
          "Runtime descriptors that do not support subagents must not declare subagent execution modes.",
      });
    }
  });
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

export const runtimeCapabilityKeyValues = [
  "supportsProfiles",
  "supportsVariants",
  "supportsSlashCommands",
  "supportsFileSearch",
  "supportsOdtWorkflowTools",
  "supportsSessionFork",
  "supportsQueuedUserMessages",
  "supportsPermissionRequests",
  "supportsQuestionRequests",
  "supportsTodos",
  "supportsDiff",
  "supportsFileStatus",
  "supportsMcpStatus",
  "supportsSubagents",
] as const;
export const runtimeCapabilityKeySchema = z.enum(runtimeCapabilityKeyValues);
export type RuntimeCapabilityKey = z.infer<typeof runtimeCapabilityKeySchema>;

export const mandatoryRuntimeCapabilityKeys = [
  "supportsOdtWorkflowTools",
  "supportsSessionFork",
] as const satisfies readonly RuntimeCapabilityKey[];

export const optionalRuntimeCapabilityKeys = [
  "supportsProfiles",
  "supportsVariants",
  "supportsSlashCommands",
  "supportsFileSearch",
  "supportsPermissionRequests",
  "supportsQuestionRequests",
  "supportsTodos",
  "supportsDiff",
  "supportsFileStatus",
  "supportsMcpStatus",
  "supportsSubagents",
] as const satisfies readonly RuntimeCapabilityKey[];

export const runtimeRequiredScopesByRole = {
  spec: ["workspace"],
  planner: ["workspace"],
  qa: ["task"],
  build: ["build", "workspace"],
} as const satisfies Record<AgentRole, readonly RuntimeSupportedScope[]>;

const requiredRuntimeSupportedScopeSet = new Set<RuntimeSupportedScope>(
  Object.values(runtimeRequiredScopesByRole).flat(),
);

export const requiredRuntimeSupportedScopes = runtimeSupportedScopeValues.filter((scope) =>
  requiredRuntimeSupportedScopeSet.has(scope),
);

export const getMissingRequiredRuntimeSupportedScopes = (
  supportedScopes: readonly RuntimeSupportedScope[],
): RuntimeSupportedScope[] => {
  const supportedScopeSet = new Set<RuntimeSupportedScope>(supportedScopes);
  return requiredRuntimeSupportedScopes.filter((scope) => !supportedScopeSet.has(scope));
};

export type RuntimeCapabilityClass = "mandatory" | "optional" | "role_scoped";

export const runtimeCapabilityClasses = {
  supportsProfiles: "optional",
  supportsVariants: "optional",
  supportsSlashCommands: "optional",
  supportsFileSearch: "optional",
  supportsOdtWorkflowTools: "mandatory",
  supportsSessionFork: "mandatory",
  supportsQueuedUserMessages: "optional",
  supportsPermissionRequests: "optional",
  supportsQuestionRequests: "optional",
  supportsTodos: "optional",
  supportsDiff: "optional",
  supportsFileStatus: "optional",
  supportsMcpStatus: "optional",
  supportsSubagents: "optional",
} as const satisfies Record<RuntimeCapabilityKey, RuntimeCapabilityClass>;

export const runtimeRefSchema = z.object({
  kind: runtimeKindSchema,
});
export type RuntimeRef = z.infer<typeof runtimeRefSchema>;

export const stdioRuntimeIdentitySchema = z.string().trim().min(1);
export type StdioRuntimeIdentity = z.infer<typeof stdioRuntimeIdentitySchema>;

const runtimeToolIdSchema = z.string().trim().min(1);
const runtimeReadOnlyRoleBlockedToolsSchema = z
  .array(runtimeToolIdSchema)
  .refine((toolIds) => new Set(toolIds).size === toolIds.length, {
    message: "Read-only blocked runtime tool IDs must be unique.",
  });

const runtimeWorkflowToolAliasesSchema = z
  .array(runtimeToolIdSchema)
  .min(1, { message: "Workflow tool alias lists must not be empty." })
  .refine((toolIds) => new Set(toolIds).size === toolIds.length, {
    message: "Workflow tool aliases for a canonical tool must be unique.",
  });

const runtimeWorkflowToolAliasesByCanonicalShape = Object.fromEntries(
  ODT_WORKFLOW_AGENT_TOOL_NAMES.map((toolName) => [
    toolName,
    runtimeWorkflowToolAliasesSchema.optional(),
  ]),
) as Record<AgentToolName, z.ZodOptional<typeof runtimeWorkflowToolAliasesSchema>>;

const runtimeWorkflowToolAliasesByCanonicalSchema = z
  .object(runtimeWorkflowToolAliasesByCanonicalShape)
  .strict()
  .superRefine((aliasesByCanonical, context) => {
    const canonicalByAlias = new Map<string, AgentToolName>();

    for (const canonicalTool of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      const aliases = aliasesByCanonical[canonicalTool] ?? [];
      for (const [index, alias] of aliases.entries()) {
        if (ODT_WORKFLOW_AGENT_TOOL_NAMES.includes(alias as AgentToolName)) {
          context.addIssue({
            code: "custom",
            path: [canonicalTool, index],
            message: "Runtime workflow aliases must not repeat canonical odt_* tool IDs.",
          });
          continue;
        }

        const existingCanonicalTool = canonicalByAlias.get(alias);
        if (existingCanonicalTool && existingCanonicalTool !== canonicalTool) {
          context.addIssue({
            code: "custom",
            path: [canonicalTool, index],
            message: `Runtime workflow alias "${alias}" is already assigned to canonical tool "${existingCanonicalTool}".`,
          });
          continue;
        }

        canonicalByAlias.set(alias, canonicalTool);
      }
    }
  });

export const runtimeDescriptorSchema = z.object({
  kind: runtimeKindSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  readOnlyRoleBlockedTools: runtimeReadOnlyRoleBlockedToolsSchema,
  workflowToolAliasesByCanonical: runtimeWorkflowToolAliasesByCanonicalSchema,
  capabilities: runtimeCapabilitiesSchema,
});
export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export const runtimeTransportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local_http"),
      endpoint: z.string().trim().min(1),
      workingDirectory: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("stdio"),
      identity: stdioRuntimeIdentitySchema,
      workingDirectory: z.string().trim().min(1),
    })
    .strict(),
]);
export type RuntimeTransport = z.infer<typeof runtimeTransportSchema>;

export const runtimeDescriptorCatalogSchema = z.object({
  runtimes: z.array(runtimeDescriptorSchema),
});
export type RuntimeDescriptorCatalog = z.infer<typeof runtimeDescriptorCatalogSchema>;
