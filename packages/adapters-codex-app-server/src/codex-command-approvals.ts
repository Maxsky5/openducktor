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

const classifyAdditionalPermissions = (value: unknown): AgentApprovalMutation => {
  if (value === undefined || value === null) {
    return "unknown";
  }
  if (!isCodexAppServerRequestPermissionProfile(value)) {
    return "unknown";
  }
  if (value.network?.enabled === true) {
    return "mutating";
  }
  if (hasEntries(value.fileSystem?.write)) {
    return "mutating";
  }
  if (value.fileSystem?.entries?.some((entry) => entry.access === "write")) {
    return "mutating";
  }
  return "unknown";
};

const classifyCommandActions = (
  value: unknown,
  isAction: (
    action: unknown,
  ) => action is CodexAppServerCommandAction | CodexAppServerLegacyParsedCommand,
): AgentApprovalMutation => {
  if (!Array.isArray(value) || value.length === 0) {
    return "mutating";
  }

  return value.every((action) => isAction(action) && isReadOnlyCommandActionType(action.type))
    ? "read_only"
    : "mutating";
};

export const classifyCodexCommandRequestMutation = (
  request: CodexServerRequestRecord,
): AgentApprovalMutation => {
  if (!isPlainObject(request.params)) {
    return "unknown";
  }
  if (request.params.networkApprovalContext != null) {
    return "mutating";
  }
  const additionalPermissions = classifyAdditionalPermissions(request.params.additionalPermissions);
  if (additionalPermissions === "mutating") {
    return additionalPermissions;
  }

  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return classifyCommandActions(request.params.parsedCmd, isCodexAppServerLegacyParsedCommand);
  }

  return classifyCommandActions(request.params.commandActions, isCodexAppServerCommandAction);
};
