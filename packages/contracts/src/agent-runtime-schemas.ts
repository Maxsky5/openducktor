import { z } from "zod";

export const knownRuntimeKindValues = ["opencode"] as const;
export const knownRuntimeKindSchema = z.enum(knownRuntimeKindValues);
export type KnownRuntimeKind = z.infer<typeof knownRuntimeKindSchema>;

export const runtimeKindSchema = z.string().trim().min(1);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const runtimeProvisioningModeSchema = z.enum(["host_managed", "external"]);
export type RuntimeProvisioningMode = z.infer<typeof runtimeProvisioningModeSchema>;

export const runtimeCapabilitiesSchema = z.object({
  supportsSessionLifecycle: z.boolean(),
  supportsStreamingEvents: z.boolean(),
  supportsModelCatalog: z.boolean(),
  supportsProfiles: z.boolean(),
  supportsVariants: z.boolean(),
  supportsWorkflowTools: z.boolean(),
  supportsPermissionRequests: z.boolean(),
  supportsQuestionRequests: z.boolean(),
  supportsHistory: z.boolean(),
  supportsTodos: z.boolean(),
  supportsDiff: z.boolean(),
  supportsFileStatus: z.boolean(),
  supportsDiagnostics: z.boolean(),
  supportsWorkspaceRuntime: z.boolean(),
  supportsTaskRuntime: z.boolean(),
  supportsBuildRuntime: z.boolean(),
  supportsMcpStatus: z.boolean(),
  supportsMcpConnect: z.boolean(),
  provisioningMode: runtimeProvisioningModeSchema,
});
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

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
