import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeApprovalReplyOutcome,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { JsonObject } from "@openducktor/contracts";
import { type AgentPendingApprovalRequest, classifyAgentApprovalMutation } from "@openducktor/core";

type OpenCodePermissionReply = "once" | "always" | "reject";

const OPENCODE_APPROVAL_OUTCOMES = ["approve_once", "approve_session", "reject"] as const;
const OPENCODE_ODT_WORKFLOW_TOOL_ALIASES =
  OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

const readOptionalString = (record: JsonObject | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return hasRuntimeType(value, "string") && value.trim().length > 0 ? value : undefined;
};

export type ParsedOpenCodePermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  save?: string[];
  metadata?: JsonObject;
};

export const normalizeOpenCodeApprovalRequest = (
  request: ParsedOpenCodePermissionRequest,
): AgentPendingApprovalRequest => {
  return toAgentApprovalRequestFromOpenCodePermission(request);
};

export const toAgentApprovalRequestFromOpenCodePermission = ({
  requestId,
  permission,
  patterns,
  save,
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
    ...(patterns.length > 0 ? { affectedPaths: patterns } : undefined),
    ...(command
      ? {
          command: {
            command,
            ...(workingDirectory ? { workingDirectory } : undefined),
          },
        }
      : undefined),
    action: { name: permission },
    ...(toolName ? { tool: { name: toolName } } : undefined),
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
        ...(save && save.length > 0 ? { save } : undefined),
        ...(metadata ? { metadata } : undefined),
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
