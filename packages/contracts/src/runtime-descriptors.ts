import {
  type RuntimeCapabilities,
  type RuntimeDescriptor,
  type RuntimeKind,
  requiredRuntimeSupportedScopes,
} from "./agent-runtime-schemas";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "./odt-tool-names";

const OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS = [
  "edit",
  "write",
  "apply_patch",
  "ast_grep_replace",
  "lsp_rename",
] as const;
export const OPENCODE_ODT_TOOL_ID_PREFIXES = ["openducktor_", "functions.openducktor_"] as const;

export const toOpencodeOdtToolAliases = (canonicalOdtToolName: string): string[] =>
  OPENCODE_ODT_TOOL_ID_PREFIXES.map((prefix) => `${prefix}${canonicalOdtToolName}`);

export const toOpencodeExposedOdtToolIds = (canonicalOdtToolName: string): string[] => [
  canonicalOdtToolName,
  ...toOpencodeOdtToolAliases(canonicalOdtToolName),
];

export const isOpencodeExposedOdtToolAlias = (toolId: string): boolean =>
  OPENCODE_ODT_TOOL_ID_PREFIXES.some((prefix) => toolId.startsWith(prefix));

const createOpencodeWorkflowToolAliasesByCanonical =
  (): RuntimeDescriptor["workflowToolAliasesByCanonical"] => {
    const aliasesByCanonical: RuntimeDescriptor["workflowToolAliasesByCanonical"] = {};

    for (const toolName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      aliasesByCanonical[toolName] = toOpencodeOdtToolAliases(toolName);
    }

    return aliasesByCanonical;
  };

export const OPENCODE_RUNTIME_CAPABILITIES = {
  provisioningMode: "host_managed",
  workflow: {
    supportsOdtWorkflowTools: true,
    supportedScopes: requiredRuntimeSupportedScopes,
  },
  sessionLifecycle: {
    supportedStartModes: ["fresh", "reuse", "fork"],
    supportsSessionFork: true,
    forkTargets: ["session"],
    supportsListLiveSessions: true,
    supportsQueuedUserMessages: true,
    supportsPendingInputSnapshots: true,
  },
  history: {
    loadable: true,
    fidelity: "message",
    replay: "snapshot",
    stableItemIds: false,
    stableItemOrder: true,
    exposesCompletionState: false,
    hydratedEventTypes: ["message", "tool_call", "tool_result"],
    limitations: ["OpenCode session history is hydrated at message-level fidelity."],
  },
  approvals: {
    supportedRequestTypes: ["permission_grant", "runtime_tool"],
    supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
    omittedPermissionBehavior: "deny",
    pendingVisibility: ["live_snapshot"],
    canClassifyMutatingRequests: true,
    readOnlyAutoRejectSafe: true,
  },
  structuredInput: {
    supportsQuestions: true,
    supportsMultipleQuestions: true,
    supportedAnswerModes: ["free_text", "single_select", "multi_select"],
    supportsRequiredQuestions: true,
    supportsDefaultValues: false,
    supportsSecretInput: false,
    supportsCustomAnswers: true,
    supportsQuestionResolution: true,
    pendingVisibility: ["live_snapshot"],
  },
  promptInput: {
    supportedParts: ["text", "slash_command", "file_reference", "folder_reference"],
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: false,
  },
  optionalSurfaces: {
    supportsProfiles: true,
    supportsVariants: true,
    supportsTodos: true,
    supportsDiff: true,
    supportsFileStatus: true,
    supportsMcpStatus: true,
    supportsSubagents: true,
    supportedSubagentExecutionModes: ["foreground", "background"],
  },
} as const satisfies RuntimeCapabilities;

const CODEX_READ_ONLY_ROLE_BLOCKED_TOOLS = [
  "patch",
  "write",
  "shell",
  "network",
  "permissions",
] as const;

export const CODEX_RUNTIME_CAPABILITIES = {
  provisioningMode: "host_managed",
  workflow: {
    supportsOdtWorkflowTools: true,
    supportedScopes: requiredRuntimeSupportedScopes,
  },
  sessionLifecycle: {
    supportedStartModes: ["fresh", "reuse", "fork"],
    supportsSessionFork: true,
    forkTargets: ["session"],
    supportsListLiveSessions: true,
    supportsQueuedUserMessages: true,
    supportsPendingInputSnapshots: true,
  },
  history: {
    loadable: true,
    fidelity: "message",
    replay: "snapshot",
    stableItemIds: true,
    stableItemOrder: true,
    exposesCompletionState: false,
    hydratedEventTypes: ["message", "tool_call"],
    limitations: [],
  },
  approvals: {
    supportedRequestTypes: ["command_execution", "file_change", "permission_grant", "runtime_tool"],
    supportedReplyOutcomes: ["approve_once", "reject"],
    omittedPermissionBehavior: "deny",
    pendingVisibility: ["live_snapshot"],
    canClassifyMutatingRequests: true,
    readOnlyAutoRejectSafe: true,
  },
  structuredInput: {
    supportsQuestions: true,
    supportsMultipleQuestions: true,
    supportedAnswerModes: ["free_text", "single_select", "multi_select"],
    supportsRequiredQuestions: true,
    supportsDefaultValues: false,
    supportsSecretInput: false,
    supportsCustomAnswers: true,
    supportsQuestionResolution: true,
    pendingVisibility: ["live_snapshot"],
  },
  promptInput: {
    supportedParts: ["text", "skill_mention", "file_reference", "folder_reference"],
    supportsSlashCommands: false,
    supportsFileSearch: true,
    supportsSkillReferences: true,
  },
  optionalSurfaces: {
    supportsProfiles: false,
    supportsVariants: true,
    supportsTodos: true,
    supportsDiff: true,
    supportsFileStatus: false,
    supportsMcpStatus: true,
    supportsSubagents: false,
    supportedSubagentExecutionModes: [],
  },
} as const satisfies RuntimeCapabilities;

export const OPENCODE_RUNTIME_DESCRIPTOR = {
  kind: "opencode",
  label: "OpenCode",
  description: "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
  readOnlyRoleBlockedTools: [...OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: createOpencodeWorkflowToolAliasesByCanonical(),
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;

export const CODEX_RUNTIME_DESCRIPTOR = {
  kind: "codex",
  label: "Codex",
  description: "Local Codex app-server runtime connected through the OpenDucktor MCP bridge.",
  readOnlyRoleBlockedTools: [...CODEX_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: {},
  capabilities: CODEX_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;

export const RUNTIME_DESCRIPTORS_BY_KIND = {
  [OPENCODE_RUNTIME_DESCRIPTOR.kind]: OPENCODE_RUNTIME_DESCRIPTOR,
  [CODEX_RUNTIME_DESCRIPTOR.kind]: CODEX_RUNTIME_DESCRIPTOR,
} as const satisfies Record<RuntimeKind, RuntimeDescriptor>;
