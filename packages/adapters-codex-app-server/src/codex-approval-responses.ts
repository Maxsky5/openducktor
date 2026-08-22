import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandExecutionApprovalResponse,
  type CodexAppServerExecCommandApprovalResponse,
  type CodexAppServerGrantedPermissionProfile,
  type CodexAppServerMcpServerElicitationRequestResponse,
  type CodexAppServerPermissionsApprovalResponse,
  codexAppServerRequestPermissionProfileSchema,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";

export type CodexApprovalOutcome = RuntimeApprovalReplyOutcome;

type GenericCodexApprovalResponse = {
  approved: boolean;
  outcome: CodexApprovalOutcome;
  message: string;
};

export type CodexApprovalResponse =
  | CodexAppServerCommandExecutionApprovalResponse
  | CodexAppServerExecCommandApprovalResponse
  | CodexAppServerMcpServerElicitationRequestResponse
  | CodexAppServerPermissionsApprovalResponse
  | GenericCodexApprovalResponse;

const permissionsResponse = (
  request: CodexServerRequestRecord,
  outcome: CodexApprovalOutcome,
): CodexAppServerPermissionsApprovalResponse => {
  const approved = outcome !== "reject";
  const params = isPlainObject(request.params) ? request.params : {};
  const parsed = approved
    ? codexAppServerRequestPermissionProfileSchema.safeParse(params.permissions)
    : { success: false as const };
  if (!parsed.success) {
    return { permissions: {}, scope: "turn" };
  }
  const profile = parsed.data;

  const permissions: CodexAppServerGrantedPermissionProfile = {};
  if (profile.network) {
    permissions.network = profile.network;
  }
  if (profile.fileSystem) {
    permissions.fileSystem = {
      read: profile.fileSystem.read,
      write: profile.fileSystem.write,
      ...(() => {
        if (profile.fileSystem.globScanMaxDepth !== undefined) {
          return { globScanMaxDepth: profile.fileSystem.globScanMaxDepth };
        }
        return {};
      })(),
      ...(() => {
        if (profile.fileSystem.entries !== undefined) {
          return { entries: profile.fileSystem.entries };
        }
        return {};
      })(),
    };
  }
  return { permissions, scope: outcome === "approve_session" ? "session" : "turn" };
};

const mcpElicitationResponse = (
  outcome: CodexApprovalOutcome,
): CodexAppServerMcpServerElicitationRequestResponse => {
  switch (outcome) {
    case "approve_once":
      return { action: "accept", content: null, _meta: null };
    case "approve_session":
      return { action: "accept", content: null, _meta: { persist: "session" } };
    case "approve_always":
      return { action: "accept", content: null, _meta: { persist: "always" } };
    case "reject":
      return { action: "decline", content: null, _meta: null };
    case "approve_turn":
      throw new Error(
        "Codex MCP elicitation approvals do not support approval outcome 'approve_turn'.",
      );
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(`Unhandled Codex MCP elicitation outcome: ${String(unexpectedOutcome)}`);
    }
  }
};

export const codexApprovalResponseForRequest = ({
  message,
  outcome,
  request,
}: {
  message?: string | undefined;
  outcome: CodexApprovalOutcome;
  request: CodexServerRequestRecord;
}): CodexApprovalResponse => {
  const approved = outcome !== "reject";
  switch (request.method) {
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL:
      if (!approved) {
        return { decision: "denied" };
      }
      return {
        decision:
          outcome === "approve_session" || outcome === "approve_always"
            ? "approved_for_session"
            : "approved",
      };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL:
      if (!approved) {
        return { decision: "decline" };
      }
      return {
        decision:
          outcome === "approve_session" || outcome === "approve_always"
            ? "acceptForSession"
            : "accept",
      };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL:
      if (!approved) {
        return { decision: "decline" };
      }
      return {
        decision:
          outcome === "approve_session" || outcome === "approve_always"
            ? "acceptForSession"
            : "accept",
      };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST:
      return mcpElicitationResponse(outcome);
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL:
      return permissionsResponse(request, outcome);
    default:
      return {
        approved,
        outcome,
        message: message ?? (approved ? "Approved once." : "Rejected."),
      };
  }
};
