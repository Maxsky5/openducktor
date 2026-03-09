import {
  type RuntimeCapabilities,
  type RuntimeDescriptor,
  requiredRuntimeSupportedScopes,
} from "./agent-runtime-schemas";

export const OPENCODE_RUNTIME_CAPABILITIES = {
  supportsProfiles: true,
  supportsVariants: true,
  supportsOdtWorkflowTools: true,
  supportsPermissionRequests: true,
  supportsQuestionRequests: true,
  supportsTodos: true,
  supportsDiff: true,
  supportsFileStatus: true,
  supportsMcpStatus: true,
  supportedScopes: requiredRuntimeSupportedScopes,
  provisioningMode: "host_managed",
} as const satisfies RuntimeCapabilities;

export const OPENCODE_RUNTIME_DESCRIPTOR = {
  kind: "opencode",
  label: "OpenCode",
  description: "OpenCode local runtime with OpenDucktor MCP integration.",
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;
