import {
  type RuntimeCapabilities,
  type RuntimeDescriptor,
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
const OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES = ["openducktor_", "functions.openducktor_"] as const;

const createOpencodeWorkflowToolAliasesByCanonical =
  (): RuntimeDescriptor["workflowToolAliasesByCanonical"] => {
    const aliasesByCanonical: RuntimeDescriptor["workflowToolAliasesByCanonical"] = {};

    for (const toolName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      aliasesByCanonical[toolName] = OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES.map(
        (prefix) => `${prefix}${toolName}`,
      );
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
    supportsAttachLiveSessions: true,
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

export const OPENCODE_RUNTIME_DESCRIPTOR = {
  kind: "opencode",
  label: "OpenCode",
  description: "OpenCode local runtime with OpenDucktor MCP integration.",
  readOnlyRoleBlockedTools: [...OPENCODE_READ_ONLY_ROLE_BLOCKED_TOOLS],
  workflowToolAliasesByCanonical: createOpencodeWorkflowToolAliasesByCanonical(),
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;
