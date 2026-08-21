import {
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  type CodexAppServerCommandAction,
  type CodexAppServerLegacyParsedCommand,
  codexAppServerCommandActionSchema,
  codexAppServerLegacyParsedCommandSchema,
  codexAppServerRequestPermissionProfileSchema,
} from "@openducktor/contracts";
import type { AgentApprovalMutation } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexServerRequestRecord } from "./types";
import type { JsonValue } from "@openducktor/contracts";

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

const hasNetworkApprovalContext = (value: Record<string, JsonValue>): boolean =>
  value.networkApprovalContext !== undefined && value.networkApprovalContext !== null;

const hasAdditionalNetworkPermissions = (value: JsonValue | undefined): boolean => {
  const parsed = codexAppServerRequestPermissionProfileSchema.safeParse(value);
  return parsed.success && parsed.data.network !== null;
};

const classifyAdditionalPermissions = (value: JsonValue | undefined): AgentApprovalMutation => {
  const parsed = codexAppServerRequestPermissionProfileSchema.safeParse(value);
  if (!parsed.success) {
    return "unknown";
  }
  const profile = parsed.data;
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
  return isReadOnlyCommandActionType(action.type) ? "read_only" : "unknown";
};

const classifyCommandActions = (
  value: JsonValue | undefined,
  schema: typeof codexAppServerCommandActionSchema | typeof codexAppServerLegacyParsedCommandSchema,
): AgentApprovalMutation => {
  if (!Array.isArray(value) || value.length === 0) {
    return "unknown";
  }

  const actionMutations = value.map((action) => {
    const parsed = schema.safeParse(action);
    return parsed.success ? classifyCommandAction(parsed.data) : "unknown";
  });
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
  const params: Record<string, JsonValue> = request.params;
  const additionalPermissions = classifyAdditionalPermissions(params.additionalPermissions);
  if (additionalPermissions === "mutating") {
    return additionalPermissions;
  }
  if (
    hasNetworkApprovalContext(params) ||
    hasAdditionalNetworkPermissions(params.additionalPermissions)
  ) {
    return "unknown";
  }

  if (request.method === CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL) {
    return classifyCommandActions(params.parsedCmd, codexAppServerLegacyParsedCommandSchema);
  }

  if (
    Array.isArray(params.commandActions) &&
    params.commandActions.length === 0 &&
    !hasNetworkApprovalContext(params)
  ) {
    return "mutating";
  }

  return classifyCommandActions(params.commandActions, codexAppServerCommandActionSchema);
};
