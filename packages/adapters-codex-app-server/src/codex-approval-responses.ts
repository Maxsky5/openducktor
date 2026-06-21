import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandExecutionApprovalResponse,
  type CodexAppServerExecCommandApprovalResponse,
  type CodexAppServerGrantedPermissionProfile,
  type CodexAppServerMcpServerElicitationRequestResponse,
  type CodexAppServerPermissionsApprovalResponse,
  isCodexAppServerRequestPermissionProfile,
} from "@openducktor/contracts";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";

export type CodexApprovalOutcome = "approve_once" | "reject";

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
  approved: boolean,
): CodexAppServerPermissionsApprovalResponse => {
  const params = isPlainObject(request.params) ? request.params : {};
  if (!approved || !isCodexAppServerRequestPermissionProfile(params.permissions)) {
    return { permissions: {}, scope: "turn" };
  }

  const permissions: CodexAppServerGrantedPermissionProfile = {};
  if (params.permissions.network) {
    permissions.network = params.permissions.network;
  }
  if (params.permissions.fileSystem) {
    permissions.fileSystem = params.permissions.fileSystem;
  }
  return { permissions, scope: "turn" };
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
  const approved = outcome === "approve_once";
  switch (request.method) {
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL:
      return { decision: approved ? "approved" : "denied" };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL:
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL:
      return { decision: approved ? "accept" : "decline" };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST:
      return { action: approved ? "accept" : "decline", content: null, _meta: null };
    case CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL:
      return permissionsResponse(request, approved);
    default:
      return {
        approved,
        outcome,
        message: message ?? (approved ? "Approved once." : "Rejected."),
      };
  }
};
