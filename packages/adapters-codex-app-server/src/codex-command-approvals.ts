import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandAction,
  type CodexAppServerLegacyParsedCommand,
  isCodexAppServerCommandAction,
  isCodexAppServerLegacyParsedCommand,
  isCodexAppServerRequestPermissionProfile,
} from "@openducktor/contracts";
import type { AgentApprovalMutation } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";

type ReadOnlyCommandActionType =
  | Extract<CodexAppServerCommandAction["type"], "read" | "listFiles" | "search">
  | Extract<CodexAppServerLegacyParsedCommand["type"], "read" | "list_files" | "search">;

const READ_ONLY_COMMAND_ACTION_TYPES = new Set<ReadOnlyCommandActionType>([
  "read",
  "listFiles",
  "list_files",
  "search",
]);

const isReadOnlyCommandActionType = (value: string): value is ReadOnlyCommandActionType =>
  READ_ONLY_COMMAND_ACTION_TYPES.has(value as ReadOnlyCommandActionType);

const hasEntries = <T>(value: readonly T[] | null | undefined): boolean =>
  Array.isArray(value) && value.length > 0;

const hasNetworkApprovalContext = (value: Record<string, unknown>): boolean =>
  value.networkApprovalContext !== undefined && value.networkApprovalContext !== null;

const hasAdditionalNetworkPermissions = (value: unknown): boolean =>
  isCodexAppServerRequestPermissionProfile(value) && value.network !== null;

const classifyAdditionalPermissions = (value: unknown): AgentApprovalMutation => {
  if (value === undefined || value === null) {
    return "unknown";
  }
  if (!isCodexAppServerRequestPermissionProfile(value)) {
    return "unknown";
  }
  if (hasEntries(value.fileSystem?.write)) {
    return "mutating";
  }
  if (value.fileSystem?.entries?.some((entry) => entry.access === "write")) {
    return "mutating";
  }
  return "unknown";
};

const classifyCommandAction = (
  action: unknown,
  isAction: (
    action: unknown,
  ) => action is CodexAppServerCommandAction | CodexAppServerLegacyParsedCommand,
): AgentApprovalMutation => {
  if (!isAction(action)) {
    return "unknown";
  }
  return isReadOnlyCommandActionType(action.type) ? "read_only" : "unknown";
};

const classifyCommandActions = (
  value: unknown,
  isAction: (
    action: unknown,
  ) => action is CodexAppServerCommandAction | CodexAppServerLegacyParsedCommand,
): AgentApprovalMutation => {
  if (!Array.isArray(value) || value.length === 0) {
    return "unknown";
  }

  const actionMutations = value.map((action) => classifyCommandAction(action, isAction));
  if (actionMutations.some((mutation) => mutation === "mutating")) {
    return "mutating";
  }
  return actionMutations.every((mutation) => mutation === "read_only") ? "read_only" : "unknown";
};

export const classifyCodexCommandRequestMutation = (
  request: CodexServerRequestRecord,
): AgentApprovalMutation => {
  if (!isPlainObject(request.params)) {
    return "unknown";
  }
  const additionalPermissions = classifyAdditionalPermissions(request.params.additionalPermissions);
  if (additionalPermissions === "mutating") {
    return additionalPermissions;
  }
  if (
    hasNetworkApprovalContext(request.params) ||
    hasAdditionalNetworkPermissions(request.params.additionalPermissions)
  ) {
    return "unknown";
  }

  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return classifyCommandActions(request.params.parsedCmd, isCodexAppServerLegacyParsedCommand);
  }

  if (
    Array.isArray(request.params.commandActions) &&
    request.params.commandActions.length === 0 &&
    !hasNetworkApprovalContext(request.params)
  ) {
    return "mutating";
  }

  return classifyCommandActions(request.params.commandActions, isCodexAppServerCommandAction);
};
