import { z } from "zod";
import type { AgentRole } from "./agent-workflow-schemas";

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

export const runtimeCapabilitiesSchema = z.object({
  supportsProfiles: z.boolean(),
  supportsVariants: z.boolean(),
  supportsOdtWorkflowTools: z.boolean(),
  supportsPermissionRequests: z.boolean(),
  supportsQuestionRequests: z.boolean(),
  supportsTodos: z.boolean(),
  supportsDiff: z.boolean(),
  supportsFileStatus: z.boolean(),
  supportsMcpStatus: z.boolean(),
  supportedScopes: runtimeSupportedScopesSchema,
  provisioningMode: runtimeProvisioningModeSchema,
});
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

export const runtimeCapabilityKeyValues = [
  "supportsProfiles",
  "supportsVariants",
  "supportsOdtWorkflowTools",
  "supportsPermissionRequests",
  "supportsQuestionRequests",
  "supportsTodos",
  "supportsDiff",
  "supportsFileStatus",
  "supportsMcpStatus",
] as const;
export const runtimeCapabilityKeySchema = z.enum(runtimeCapabilityKeyValues);
export type RuntimeCapabilityKey = z.infer<typeof runtimeCapabilityKeySchema>;

export const mandatoryRuntimeCapabilityKeys = [
  "supportsOdtWorkflowTools",
] as const satisfies readonly RuntimeCapabilityKey[];

export const optionalRuntimeCapabilityKeys = [
  "supportsProfiles",
  "supportsVariants",
  "supportsPermissionRequests",
  "supportsQuestionRequests",
  "supportsTodos",
  "supportsDiff",
  "supportsFileStatus",
  "supportsMcpStatus",
] as const satisfies readonly RuntimeCapabilityKey[];

export const runtimeRequiredScopesByRole = {
  spec: ["workspace"],
  planner: ["workspace"],
  qa: ["task"],
  build: ["build", "workspace"],
} as const satisfies Record<AgentRole, readonly RuntimeSupportedScope[]>;

export type RuntimeCapabilityClass = "mandatory" | "optional" | "role_scoped";

export const runtimeCapabilityClasses = {
  supportsProfiles: "optional",
  supportsVariants: "optional",
  supportsOdtWorkflowTools: "mandatory",
  supportsPermissionRequests: "optional",
  supportsQuestionRequests: "optional",
  supportsTodos: "optional",
  supportsDiff: "optional",
  supportsFileStatus: "optional",
  supportsMcpStatus: "optional",
} as const satisfies Record<RuntimeCapabilityKey, RuntimeCapabilityClass>;

export const runtimeRefSchema = z.object({
  kind: runtimeKindSchema,
});
export type RuntimeRef = z.infer<typeof runtimeRefSchema>;

export const runtimeDescriptorSchema = z.object({
  kind: runtimeKindSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  capabilities: runtimeCapabilitiesSchema,
});
export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export const runtimeTransportSchema = z.object({
  endpoint: z.string().min(1).optional(),
  workingDirectory: z.string().min(1),
});
export type RuntimeTransport = z.infer<typeof runtimeTransportSchema>;

export const runtimeDescriptorCatalogSchema = z.object({
  runtimes: z.array(runtimeDescriptorSchema),
});
export type RuntimeDescriptorCatalog = z.infer<typeof runtimeDescriptorCatalogSchema>;
