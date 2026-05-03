import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import {
  type AgentApprovalMutation,
  type AgentPendingApprovalRequest,
  isOdtWorkflowMutationToolName,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";

type UnknownRecord = Record<string, unknown>;
type OpenCodePermissionReply = "once" | "always" | "reject";

const OPENCODE_APPROVAL_OUTCOMES = ["approve_once", "approve_session", "reject"] as const;

const MUTATING_HINTS = [
  "write",
  "edit",
  "patch",
  "delete",
  "rename",
  "move",
  "mkdir",
  "create",
  "chmod",
  "chown",
  "truncate",
];

const MUTATING_TOOL_NAMES = new Set([
  "edit",
  "write",
  "create",
  "delete",
  "multiedit",
  "apply_patch",
  "str_replace",
  "build_blocked",
  "build_resumed",
  "build_completed",
]);

const SAFE_READ_TOOL_NAMES = new Set([
  "read",
  "view",
  "cat",
  "list",
  "ls",
  "glob",
  "grep",
  "find",
  "search",
]);

const SHELL_PERMISSION_HINTS = ["bash", "shell", "exec", "command"];
const OPENCODE_ODT_WORKFLOW_TOOL_ALIASES =
  OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

const MUTATING_SHELL_PATTERNS = [
  /\b(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|truncate)\b/,
  /\b(git\s+(add|commit|push|pull|merge|rebase|checkout|switch|reset|clean|stash))\b/,
  /\b(sed\s+-i|perl\s+-i)\b/,
  />\s*[^=]/,
  />>/,
  /\btee\b/,
];

const SAFE_READ_SHELL_PATTERNS = [
  /^cat\b/,
  /^sed\s+-n\b/,
  /^head\b/,
  /^tail\b/,
  /^less\b/,
  /^more\b/,
  /^ls\b/,
  /^rg\b/,
  /^grep\b/,
  /^find\b/,
  /^git\s+(status|show|log|diff)\b/,
  /^pwd\b/,
  /^wc\b/,
  /^stat\b/,
  /^readlink\b/,
  /^test\b/,
  /^echo\b/,
  /^printf\b/,
];

const asRecord = (value: unknown): UnknownRecord | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
};

const readString = (record: UnknownRecord, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const readStringArray = (record: UnknownRecord, key: string): string[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const toLower = (value: unknown): string => (typeof value === "string" ? value.toLowerCase() : "");

const hasMutatingHint = (value: string): boolean =>
  MUTATING_HINTS.some((hint) => value.includes(hint));

const isReadOnlyShellSegment = (value: string): boolean => {
  const segment = value.trim();
  if (segment.length === 0) {
    return false;
  }
  return SAFE_READ_SHELL_PATTERNS.some((pattern) => pattern.test(segment));
};

const isReadOnlyShellCommand = (command: string): boolean => {
  const normalized = command.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const segments = normalized
    .split(/&&|\|\||;|\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return segments.length > 0 && segments.every((segment) => isReadOnlyShellSegment(segment));
};

const classifyOpenCodeToolName = (toolName: string): AgentApprovalMutation | null => {
  const trimmedToolName = toolName.trim();
  if (trimmedToolName.length === 0) {
    return null;
  }

  if (isOdtWorkflowMutationToolName(trimmedToolName, OPENCODE_ODT_WORKFLOW_TOOL_ALIASES)) {
    return "mutating";
  }
  if (normalizeOdtWorkflowToolName(trimmedToolName, OPENCODE_ODT_WORKFLOW_TOOL_ALIASES)) {
    return "read_only";
  }

  const lowerToolName = trimmedToolName.toLowerCase();
  if (MUTATING_TOOL_NAMES.has(lowerToolName) || hasMutatingHint(lowerToolName)) {
    return "mutating";
  }
  if (SAFE_READ_TOOL_NAMES.has(lowerToolName)) {
    return "read_only";
  }

  return null;
};

const classifyOpenCodeApprovalMutation = (
  permission: string,
  patterns: string[],
  metadata?: UnknownRecord,
): AgentApprovalMutation => {
  const permissionLower = permission.trim().toLowerCase();
  const permissionToolMutation = classifyOpenCodeToolName(permission);
  if (permissionToolMutation) {
    return permissionToolMutation;
  }

  if (hasMutatingHint(permissionLower)) {
    return "mutating";
  }

  const metadataTool = typeof metadata?.tool === "string" ? metadata.tool : undefined;
  if (metadataTool) {
    return classifyOpenCodeToolName(metadataTool) ?? "unknown";
  }

  const lowerPatterns = patterns.map((pattern) => pattern.toLowerCase());
  if (lowerPatterns.some((pattern) => hasMutatingHint(pattern))) {
    return "mutating";
  }

  const shellPermission =
    SHELL_PERMISSION_HINTS.some((hint) => permissionLower.includes(hint)) ||
    lowerPatterns.some((pattern) => SHELL_PERMISSION_HINTS.some((hint) => pattern.includes(hint)));
  const commandLower = toLower(metadata?.command);

  if (commandLower.length === 0) {
    return "unknown";
  }
  if (isReadOnlyShellCommand(commandLower)) {
    return "read_only";
  }
  if (!shellPermission) {
    return MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(commandLower))
      ? "mutating"
      : "unknown";
  }
  return "mutating";
};

export type ParsedOpenCodePermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  metadata?: UnknownRecord;
};

export const normalizeOpenCodeApprovalRequest = (
  value: unknown,
): AgentPendingApprovalRequest | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const requestId = readString(record, ["id", "requestID", "requestId"]);
  const permission = readString(record, ["permission"]);
  if (!requestId || !permission) {
    return null;
  }

  return toAgentApprovalRequestFromOpenCodePermission({
    requestId,
    permission,
    patterns: readStringArray(record, "patterns"),
    ...(asRecord(record.metadata) ? { metadata: asRecord(record.metadata) as UnknownRecord } : {}),
  });
};

export const toAgentApprovalRequestFromOpenCodePermission = ({
  requestId,
  permission,
  patterns,
  metadata,
}: ParsedOpenCodePermissionRequest): AgentPendingApprovalRequest => {
  const toolName = typeof metadata?.tool === "string" ? metadata.tool : undefined;
  const command = typeof metadata?.command === "string" ? metadata.command : undefined;
  const title = toolName
    ? `Approve runtime tool: ${toolName}`
    : `Approve permission: ${permission}`;
  const summary = `OpenCode requested approval for ${permission}.`;
  const workingDirectory =
    typeof metadata?.workingDirectory === "string" ? metadata.workingDirectory : undefined;

  return {
    requestId,
    requestType: toolName ? "runtime_tool" : "permission_grant",
    title,
    summary,
    ...(patterns.length > 0 ? { affectedPaths: patterns } : {}),
    ...(command ? { command: { command, ...(workingDirectory ? { workingDirectory } : {}) } } : {}),
    action: { name: permission },
    ...(toolName ? { tool: { name: toolName } } : {}),
    mutation: classifyOpenCodeApprovalMutation(permission, patterns, metadata),
    supportedReplyOutcomes: [...OPENCODE_APPROVAL_OUTCOMES],
    metadata: {
      opencode: {
        permission,
        patterns,
        ...(metadata ? { metadata } : {}),
      },
    },
  };
};

export const toOpenCodePermissionReply = (
  outcome: RuntimeApprovalReplyOutcome,
): OpenCodePermissionReply => {
  switch (outcome) {
    case "approve_once":
      return "once";
    case "approve_session":
      return "always";
    case "reject":
      return "reject";
    case "approve_turn":
      throw new Error(
        "OpenCode runtime does not support approval outcome 'approve_turn'. Supported outcomes: approve_once, approve_session, reject.",
      );
  }
};
