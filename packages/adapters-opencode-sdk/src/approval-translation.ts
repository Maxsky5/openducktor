import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import type { OpenCodeProtocolObject } from "./guards";
import { type AgentPendingApprovalRequest, classifyAgentApprovalMutation } from "@openducktor/core";
import { z } from "zod";

type OpenCodePermissionReply = "once" | "always" | "reject";

const OPENCODE_APPROVAL_OUTCOMES = ["approve_once", "approve_session", "reject"] as const;
const OPENCODE_ODT_WORKFLOW_TOOL_ALIASES =
  OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

const readOptionalString = (
  record: OpenCodeProtocolObject | undefined,
  key: string,
): string | undefined => {
  const value = record?.[key];
  const parsed = z.string().safeParse(value);
  return parsed.success && parsed.data.trim().length > 0 ? parsed.data : undefined;
};

export type ParsedOpenCodePermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  save?: string[];
  metadata?: OpenCodeProtocolObject;
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

  const opencodeMetadata: OpenCodeProtocolObject = { permission, patterns };
  if (save && save.length > 0) {
    opencodeMetadata.save = save;
  }
  if (metadata) {
    opencodeMetadata.metadata = metadata;
  }

  const approvalRequest: AgentPendingApprovalRequest = {
    requestId,
    requestType: toolName ? "runtime_tool" : "permission_grant",
    title,
    summary,
    action: { name: permission },
    mutation: classifyAgentApprovalMutation({
      actionName: permission,
      toolName,
      affectedPaths: patterns,
      command,
      workflowToolAliasesByCanonical: OPENCODE_ODT_WORKFLOW_TOOL_ALIASES,
    }),
    supportedReplyOutcomes: [...OPENCODE_APPROVAL_OUTCOMES],
    metadata: {
      opencode: opencodeMetadata,
    },
  };
  if (patterns.length > 0) {
    approvalRequest.affectedPaths = patterns;
  }
  if (command) {
    approvalRequest.command = workingDirectory ? { command, workingDirectory } : { command };
  }
  if (toolName) {
    approvalRequest.tool = { name: toolName };
  }
  return approvalRequest;
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
