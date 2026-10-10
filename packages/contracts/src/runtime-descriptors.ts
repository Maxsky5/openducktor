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
  speed: { support: "none" },
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
    supportsInterruptedTurnResume: false,
  },
  history: {
    loadable: true,
    fidelity: "message",
    replay: "snapshot",
    stableItemIds: true,
    stableItemOrder: true,
    exposesCompletionState: true,
    limitations: [
      "OpenCode owns V1 history conversion. Unavailable attachments and interrupted tools remain visible. V1 session permissions and plugins do not carry their old behavior into V2.",
    ],
  },
  approvals: {
    supportedRequestTypes: ["permission_grant", "runtime_tool"],
    supportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
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
    supportedParts: [
      "text",
      "slash_command",
      "file_reference",
      "folder_reference",
      "skill_mention",
      "subagent_reference",
    ],
    supportsAttachments: true,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: true,
    supportsSubagentReferences: true,
  },
  optionalSurfaces: {
    supportsProfiles: true,
    supportsVariants: true,
    supportsTodos: false,
    supportsDiff: true,
    supportsFileStatus: true,
    supportsMcpStatus: true,
    supportsImageGeneration: false,
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
  speed: { support: "model" },
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
    supportsInterruptedTurnResume: true,
  },
  history: {
    loadable: true,
    fidelity: "message",
    replay: "snapshot",
    stableItemIds: true,
    stableItemOrder: true,
    exposesCompletionState: false,
    limitations: [],
  },
  approvals: {
    supportedRequestTypes: ["command_execution", "file_change", "permission_grant", "runtime_tool"],
    supportedReplyOutcomes: ["approve_once", "approve_session", "approve_always", "reject"],
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
    supportedParts: [
      "text",
      "slash_command",
      "skill_mention",
      "file_reference",
      "folder_reference",
    ],
    supportsAttachments: true,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: true,
    supportsSubagentReferences: false,
  },
  optionalSurfaces: {
    supportsProfiles: false,
    supportsVariants: true,
    supportsTodos: true,
    supportsDiff: true,
    supportsFileStatus: false,
    supportsMcpStatus: true,
    supportsImageGeneration: true,
    supportsSubagents: true,
    supportedSubagentExecutionModes: [],
  },
} as const satisfies RuntimeCapabilities;

const CLAUDE_READ_ONLY_ROLE_BLOCKED_TOOLS = [
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Write",
  "WebFetch",
  "WebSearch",
] as const;

export const CLAUDE_ODT_TOOL_ID_PREFIXES = ["mcp__openducktor__"] as const;

export const toClaudeOdtToolAliases = (canonicalOdtToolName: string): string[] =>
  CLAUDE_ODT_TOOL_ID_PREFIXES.map((prefix) => `${prefix}${canonicalOdtToolName}`);

const createClaudeWorkflowToolAliasesByCanonical =
  (): RuntimeDescriptor["workflowToolAliasesByCanonical"] => {
    const aliasesByCanonical: RuntimeDescriptor["workflowToolAliasesByCanonical"] = {};

    for (const toolName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      aliasesByCanonical[toolName] = toClaudeOdtToolAliases(toolName);
    }

    return aliasesByCanonical;
  };

export const CLAUDE_RUNTIME_CAPABILITIES = {
  speed: { support: "model" },
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
    supportsInterruptedTurnResume: true,
  },
  history: {
    loadable: true,
    fidelity: "message",
    replay: "snapshot",
    stableItemIds: true,
    stableItemOrder: true,
    exposesCompletionState: false,
    limitations: [
      "Claude Agent SDK session history is loaded from SDK transcript messages; live reconciliation also honors SDK retraction and supersession metadata.",
    ],
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
    supportedParts: [
      "text",
      "slash_command",
      "skill_mention",
      "file_reference",
      "folder_reference",
    ],
    supportsAttachments: true,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: true,
    supportsSubagentReferences: false,
  },
  optionalSurfaces: {
    supportsProfiles: false,
    supportsVariants: true,
    supportsTodos: true,
    supportsDiff: false,
    supportsFileStatus: false,
    supportsMcpStatus: false,
    supportsImageGeneration: false,
    supportsSubagents: true,
    supportedSubagentExecutionModes: ["foreground", "background"],
  },
} as const satisfies RuntimeCapabilities;

export const OPENCODE_RUNTIME_DESCRIPTOR = {
  kind: "opencode",
  label: "OpenCode",
  description: "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
  readOnlyRoleBlockedTools: [...OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: createOpencodeWorkflowToolAliasesByCanonical(),
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
  capabilityLimits: [
    {
      scope: "workflow",
      surface: "subagents",
      reason:
        "OpenDucktor workflow sessions do not allow subagent references. Use a workspace conversation for subagents.",
    },
    {
      scope: "runtime",
      surface: "todos",
      reason:
        "OpenCode V2 has no public todo-state API. Historical tool content remains available.",
    },
    {
      scope: "runtime",
      surface: "interrupted_turn_resume",
      reason:
        "OpenCode V2 has no public continuation endpoint. Reopen the conversation and send a new message.",
    },
  ],
} as const satisfies RuntimeDescriptor;

export const CODEX_RUNTIME_DESCRIPTOR = {
  capabilityLimits: [],
  kind: "codex",
  label: "Codex",
  description: "Local Codex app-server runtime connected through the OpenDucktor MCP bridge.",
  readOnlyRoleBlockedTools: [...CODEX_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: {},
  capabilities: CODEX_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;

export const CLAUDE_RUNTIME_DESCRIPTOR = {
  capabilityLimits: [],
  kind: "claude",
  label: "Claude",
  description: "Local Claude Agent SDK runtime connected through the OpenDucktor MCP bridge.",
  readOnlyRoleBlockedTools: [...CLAUDE_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: createClaudeWorkflowToolAliasesByCanonical(),
  capabilities: CLAUDE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;

export const RUNTIME_DESCRIPTORS_BY_KIND = {
  [OPENCODE_RUNTIME_DESCRIPTOR.kind]: OPENCODE_RUNTIME_DESCRIPTOR,
  [CODEX_RUNTIME_DESCRIPTOR.kind]: CODEX_RUNTIME_DESCRIPTOR,
  [CLAUDE_RUNTIME_DESCRIPTOR.kind]: CLAUDE_RUNTIME_DESCRIPTOR,
} as const satisfies Record<RuntimeKind, RuntimeDescriptor>;
