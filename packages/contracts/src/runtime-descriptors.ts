import type { RuntimeCapabilities, RuntimeDescriptor } from "./agent-runtime-schemas";

export const OPENCODE_RUNTIME_CAPABILITIES = {
  supportsSessionLifecycle: true,
  supportsStreamingEvents: true,
  supportsModelCatalog: true,
  supportsProfiles: true,
  supportsVariants: true,
  supportsWorkflowTools: true,
  supportsPermissionRequests: true,
  supportsQuestionRequests: true,
  supportsHistory: true,
  supportsTodos: true,
  supportsDiff: true,
  supportsFileStatus: true,
  supportsDiagnostics: true,
  supportsWorkspaceRuntime: true,
  supportsTaskRuntime: true,
  supportsBuildRuntime: true,
  supportsMcpStatus: true,
  supportsMcpConnect: true,
  provisioningMode: "host_managed",
} as const satisfies RuntimeCapabilities;

export const OPENCODE_RUNTIME_DESCRIPTOR = {
  kind: "opencode",
  label: "OpenCode",
  description: "OpenCode local runtime with OpenDucktor MCP integration.",
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;
