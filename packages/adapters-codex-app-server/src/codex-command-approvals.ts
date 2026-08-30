import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandAction,
  type CodexAppServerLegacyParsedCommand,
} from "@openducktor/contracts";
import type { AgentApprovalMutation } from "@openducktor/core";
import type { CodexServerRequestRecord } from "./types";

type LegacyCommandApprovalRequest = Extract<
  CodexServerRequestRecord,
  { method: typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL }
>;
type CommandExecutionApprovalRequest = Extract<
  CodexServerRequestRecord,
  {
    method: typeof CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL;
  }
>;
type CodexCommandApprovalRequest = LegacyCommandApprovalRequest | CommandExecutionApprovalRequest;

const hasEntries = <T>(value: readonly T[] | null | undefined): boolean =>
  Array.isArray(value) && value.length > 0;

const hasNetworkApprovalContext = (request: CommandExecutionApprovalRequest): boolean =>
  request.params.networkApprovalContext !== undefined &&
  request.params.networkApprovalContext !== null;

const hasAdditionalNetworkPermissions = (
  profile: CommandExecutionApprovalRequest["params"]["additionalPermissions"],
): boolean => profile?.network != null;

const classifyAdditionalPermissions = (
  profile: CommandExecutionApprovalRequest["params"]["additionalPermissions"],
): AgentApprovalMutation => {
  if (!profile) {
    return "unknown";
  }
  if (hasEntries(profile.fileSystem?.write)) {
    return "mutating";
  }
  if (profile.fileSystem?.entries?.some((entry) => entry.access === "write")) {
    return "mutating";
  }
  return "unknown";
};

const classifyCommandAction = (
  action: CodexAppServerCommandAction | CodexAppServerLegacyParsedCommand,
): AgentApprovalMutation => {
  switch (action.type) {
    case "read":
    case "listFiles":
    case "list_files":
    case "search":
      return "read_only";
    case "unknown":
      return "unknown";
  }
};

const classifyCommandActions = (
  actions:
    | readonly CodexAppServerCommandAction[]
    | readonly CodexAppServerLegacyParsedCommand[]
    | null
    | undefined,
): AgentApprovalMutation => {
  if (!actions || actions.length === 0) {
    return "unknown";
  }

  const actionMutations = actions.map(classifyCommandAction);
  if (actionMutations.some((mutation) => mutation === "mutating")) {
    return "mutating";
  }
  return actionMutations.every((mutation) => mutation === "read_only") ? "read_only" : "unknown";
};

export const classifyCodexCommandRequestMutation = (
  request: CodexCommandApprovalRequest,
): AgentApprovalMutation => {
  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return classifyCommandActions(request.params.parsedCmd);
  }

  const additionalPermissions = classifyAdditionalPermissions(request.params.additionalPermissions);
  if (additionalPermissions === "mutating") {
    return additionalPermissions;
  }
  if (
    hasNetworkApprovalContext(request) ||
    hasAdditionalNetworkPermissions(request.params.additionalPermissions)
  ) {
    return "unknown";
  }

  if (request.params.commandActions?.length === 0 && !hasNetworkApprovalContext(request)) {
    return "mutating";
  }

  return classifyCommandActions(request.params.commandActions);
};
