import {
  type RuntimeCapabilities,
  type RuntimeDescriptor,
  requiredRuntimeSupportedScopes,
} from "./agent-runtime-schemas";

const OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS = [
  "edit",
  "write",
  "apply_patch",
  "ast_grep_replace",
  "lsp_rename",
] as const;

export const OPENCODE_RUNTIME_CAPABILITIES = {
  supportsProfiles: true,
  supportsVariants: true,
  supportsSlashCommands: true,
  supportsOdtWorkflowTools: true,
  supportsSessionFork: true,
  supportsQueuedUserMessages: true,
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
  readOnlyRoleBlockedTools: [...OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS],
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;
