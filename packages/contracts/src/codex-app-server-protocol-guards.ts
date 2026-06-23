import type {
  CodexAppServerAdditionalFileSystemPermissions,
  CodexAppServerAdditionalNetworkPermissions,
  CodexAppServerCommandAction,
  CodexAppServerFileSystemPath,
  CodexAppServerFileSystemSandboxEntry,
  CodexAppServerFileSystemSpecialPath,
  CodexAppServerLegacyParsedCommand,
  CodexAppServerMcpServerElicitationRequestParams,
  CodexAppServerRequestPermissionProfile,
} from "./codex-app-server-protocol";

const isCodexAppServerRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isJsonValue = (value: unknown): boolean => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!isCodexAppServerRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
};

const isNullableStringArray = (value: unknown): value is string[] | null =>
  value === null || (Array.isArray(value) && value.every((item) => typeof item === "string"));

export const isCodexAppServerCommandAction = (
  value: unknown,
): value is CodexAppServerCommandAction => {
  if (!isCodexAppServerRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "read":
      return (
        typeof value.command === "string" &&
        typeof value.name === "string" &&
        typeof value.path === "string"
      );
    case "listFiles":
      return typeof value.command === "string" && isNullableString(value.path);
    case "search":
      return (
        typeof value.command === "string" &&
        isNullableString(value.path) &&
        isNullableString(value.query)
      );
    case "unknown":
      return typeof value.command === "string";
    default:
      return false;
  }
};

export const isCodexAppServerLegacyParsedCommand = (
  value: unknown,
): value is CodexAppServerLegacyParsedCommand => {
  if (!isCodexAppServerRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "read":
      return (
        typeof value.cmd === "string" &&
        typeof value.name === "string" &&
        typeof value.path === "string"
      );
    case "list_files":
      return typeof value.cmd === "string" && isNullableString(value.path);
    case "search":
      return (
        typeof value.cmd === "string" &&
        isNullableString(value.path) &&
        isNullableString(value.query)
      );
    case "unknown":
      return typeof value.cmd === "string";
    default:
      return false;
  }
};

const isCodexAppServerAdditionalNetworkPermissions = (
  value: unknown,
): value is CodexAppServerAdditionalNetworkPermissions =>
  isCodexAppServerRecord(value) && (value.enabled === null || typeof value.enabled === "boolean");

const isCodexAppServerFileSystemSpecialPath = (
  value: unknown,
): value is CodexAppServerFileSystemSpecialPath => {
  if (!isCodexAppServerRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  switch (value.kind) {
    case "root":
    case "minimal":
    case "tmpdir":
    case "slash_tmp":
      return true;
    case "project_roots":
      return isNullableString(value.subpath);
    case "unknown":
      return typeof value.path === "string" && isNullableString(value.subpath);
    default:
      return false;
  }
};

const isCodexAppServerFileSystemPath = (value: unknown): value is CodexAppServerFileSystemPath => {
  if (!isCodexAppServerRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "path":
      return typeof value.path === "string";
    case "glob_pattern":
      return typeof value.pattern === "string";
    case "special":
      return isCodexAppServerFileSystemSpecialPath(value.value);
    default:
      return false;
  }
};

const isCodexAppServerFileSystemSandboxEntry = (
  value: unknown,
): value is CodexAppServerFileSystemSandboxEntry =>
  isCodexAppServerRecord(value) &&
  isCodexAppServerFileSystemPath(value.path) &&
  (value.access === "read" || value.access === "write" || value.access === "deny");

const isCodexAppServerAdditionalFileSystemPermissions = (
  value: unknown,
): value is CodexAppServerAdditionalFileSystemPermissions =>
  isCodexAppServerRecord(value) &&
  isNullableStringArray(value.read) &&
  isNullableStringArray(value.write) &&
  (value.globScanMaxDepth === undefined ||
    (typeof value.globScanMaxDepth === "number" && Number.isFinite(value.globScanMaxDepth))) &&
  (value.entries === undefined ||
    (Array.isArray(value.entries) && value.entries.every(isCodexAppServerFileSystemSandboxEntry)));

export const isCodexAppServerRequestPermissionProfile = (
  value: unknown,
): value is CodexAppServerRequestPermissionProfile =>
  isCodexAppServerRecord(value) &&
  (value.network === null || isCodexAppServerAdditionalNetworkPermissions(value.network)) &&
  (value.fileSystem === null || isCodexAppServerAdditionalFileSystemPermissions(value.fileSystem));

export const isCodexAppServerMcpServerElicitationRequestParams = (
  value: unknown,
): value is CodexAppServerMcpServerElicitationRequestParams => {
  if (
    !isCodexAppServerRecord(value) ||
    typeof value.threadId !== "string" ||
    !isNullableString(value.turnId) ||
    typeof value.serverName !== "string" ||
    typeof value.mode !== "string" ||
    !isJsonValue(value._meta) ||
    typeof value.message !== "string"
  ) {
    return false;
  }

  if (value.mode === "form") {
    return isJsonValue(value.requestedSchema);
  }

  if (value.mode === "url") {
    return typeof value.url === "string" && typeof value.elicitationId === "string";
  }

  return false;
};
