import {
  type RuntimeCapabilities,
  type RuntimeDescriptor,
  requiredRuntimeSupportedScopes,
} from "./agent-runtime-schemas";
import { agentToolNameValues } from "./agent-workflow-schemas";

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

    for (const toolName of agentToolNameValues) {
      aliasesByCanonical[toolName] = OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES.map(
        (prefix) => `${prefix}${toolName}`,
      );
    }

    return aliasesByCanonical;
  };

export const OPENCODE_RUNTIME_CAPABILITIES = {
  supportsProfiles: true,
  supportsVariants: true,
  supportsSlashCommands: true,
  supportsFileSearch: true,
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
  workflowToolAliasesByCanonical: createOpencodeWorkflowToolAliasesByCanonical(),
  capabilities: OPENCODE_RUNTIME_CAPABILITIES,
} as const satisfies RuntimeDescriptor;
