import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import { type AgentPendingApprovalRequest, classifyAgentApprovalMutation } from "@openducktor/core";

type UnknownRecord = Record<string, unknown>;
type OpenCodePermissionReply = "once" | "always" | "reject";

const OPENCODE_APPROVAL_OUTCOMES = ["approve_once", "approve_session", "reject"] as const;
const OPENCODE_ODT_WORKFLOW_TOOL_ALIASES =
  OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

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

const readOptionalString = (record: UnknownRecord | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

export type ParsedOpenCodePermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  metadata?: UnknownRecord;
};

export const normalizeOpenCodeApprovalRequest = (value: unknown): AgentPendingApprovalRequest => {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Malformed Opencode pending approval payload: expected an object.");
  }

  const requestId = readString(record, ["id", "requestID", "requestId"]);
  const permission = readString(record, ["permission"]);
  if (!requestId) {
    throw new Error("Malformed Opencode pending approval payload: missing request id.");
  }
  if (!permission) {
    throw new Error("Malformed Opencode pending approval payload: missing permission.");
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
  const toolName = readOptionalString(metadata, "tool");
  const command = readOptionalString(metadata, "command");
  const title = toolName
    ? `Approve runtime tool: ${toolName}`
    : `Approve permission: ${permission}`;
  const summary = `OpenCode requested approval for ${permission}.`;
  const workingDirectory = readOptionalString(metadata, "workingDirectory");

  return {
    requestId,
    requestType: toolName ? "runtime_tool" : "permission_grant",
    title,
    summary,
    ...(patterns.length > 0 ? { affectedPaths: patterns } : {}),
    ...(command ? { command: { command, ...(workingDirectory ? { workingDirectory } : {}) } } : {}),
    action: { name: permission },
    ...(toolName ? { tool: { name: toolName } } : {}),
    mutation: classifyAgentApprovalMutation({
      actionName: permission,
      toolName,
      affectedPaths: patterns,
      command,
      workflowToolAliasesByCanonical: OPENCODE_ODT_WORKFLOW_TOOL_ALIASES,
    }),
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
    case "approve_always":
      throw new Error(
        "OpenCode runtime does not support approval outcome 'approve_always'. Supported outcomes: approve_once, approve_session, reject.",
      );
  }
};
