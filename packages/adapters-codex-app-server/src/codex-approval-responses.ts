import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandExecutionApprovalResponse,
  type CodexAppServerExecCommandApprovalResponse,
  type CodexAppServerGrantedPermissionProfile,
  type CodexAppServerMcpServerElicitationRequestResponse,
  type CodexAppServerPermissionsApprovalResponse,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import type { CodexServerRequestRecord } from "./types";

export type CodexApprovalOutcome = RuntimeApprovalReplyOutcome;

export type CodexApprovalResponse =
  | CodexAppServerCommandExecutionApprovalResponse
  | CodexAppServerExecCommandApprovalResponse
  | CodexAppServerMcpServerElicitationRequestResponse
  | CodexAppServerPermissionsApprovalResponse;

const permissionsResponse = (
  request: Extract<
    CodexServerRequestRecord,
    { method: typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL }
  >,
  outcome: CodexApprovalOutcome,
): CodexAppServerPermissionsApprovalResponse => {
  if (outcome === "reject") {
    return { permissions: {}, scope: "turn" };
  }
  const profile = request.params.permissions;

  const permissions: CodexAppServerGrantedPermissionProfile = {};
  if (profile.network) {
    permissions.network = profile.network;
  }
  if (profile.fileSystem) {
    const fileSystemPermissions: NonNullable<CodexAppServerGrantedPermissionProfile["fileSystem"]> =
      {
        read: profile.fileSystem.read,
        write: profile.fileSystem.write,
      };
    if (profile.fileSystem.globScanMaxDepth !== undefined) {
      fileSystemPermissions.globScanMaxDepth = profile.fileSystem.globScanMaxDepth;
    }
    if (profile.fileSystem.entries !== undefined) {
      fileSystemPermissions.entries = profile.fileSystem.entries;
    }
    permissions.fileSystem = fileSystemPermissions;
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
        return {
          decision: {
            denied: { rejection: message ?? "Rejected by user." },
          },
        };
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
      throw new Error(`Unsupported Codex approval request method '${request.method}'.`);
  }
};
