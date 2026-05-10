import type { CodexSessionState, CodexTurnStartResult, CodexUserInput } from "./types";

export const unsupported = (surface: string): never => {
  throw new Error(`Codex App Server adapter does not support ${surface}.`);
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const CODEX_USER_INPUT_REQUEST_METHOD = "item/tool/requestUserInput";

export type ActiveCodexTurn = {
  session: CodexSessionState;
  turnStartPromise: Promise<CodexTurnStartResult>;
  isTurnSettled: () => boolean;
  markTurnSettled: () => void;
  handledRequestKeys: Set<string>;
  queuedUserMessages: CodexUserInput[][];
  turnId?: string;
};

export type CodexLiveEventPump = {
  unsubscribe: (() => void) | null;
};

export const MAX_CODEX_EVENT_BACKLOG_PER_SESSION = 500;
export const MAX_CODEX_BUFFERED_THREAD_COUNT = 100;
export const CODEX_MODEL_CATALOG_TTL_MS = 5 * 60_000;

export const trimOldestMapKeys = <Value>(map: Map<string, Value>, maxSize: number): void => {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      return;
    }
    map.delete(oldestKey);
  }
};
export const extractText = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of ["text", "message", "content", "summary", "delta"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
};

export const isCodexUnmaterializedThreadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("is not materialized yet") &&
    message.includes("includeTurns is unavailable before first user message")
  );
};

export const isCodexThreadNotLoadedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("thread not loaded:");
};

export const extractStringField = (value: unknown, keys: string[]): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
};

export const extractNumberField = (value: unknown, keys: string[]): number | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const arrayFromUnknown = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    return [];
  }
  for (const key of ["messages", "items", "turns", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
};

export const stringifyJsonValue = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const codexToolErrorFromObject = (value: unknown): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const explicitError = extractStringField(value, ["error", "stderr"]);
  if (explicitError) {
    return explicitError;
  }
  if (value.isError === true || value.ok === false || value.success === false) {
    return extractStringField(value, ["message"]) ?? stringifyJsonValue(value);
  }
  return null;
};

export const extractOptionalObject = (
  value: unknown,
  key: string,
): Record<string, unknown> | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const candidate = value[key];
  return isPlainObject(candidate) ? candidate : undefined;
};

export const CODEX_CONTEXTUAL_USER_FRAGMENT_MARKERS = [
  ["# AGENTS.md instructions for ", "</INSTRUCTIONS>"],
  ["<environment_context>", "</environment_context>"],
  ["<skill>", "</skill>"],
  ["<user_shell_command>", "</user_shell_command>"],
  ["<turn_aborted>", "</turn_aborted>"],
  ["<subagent_notification>", "</subagent_notification>"],
] as const;

export const textMatchesCodexMarkedContextFragment = (
  text: string,
  start: string,
  end: string,
): boolean => {
  const leadingTrimmed = text.trimStart();
  const startsWithMarker =
    leadingTrimmed.slice(0, start.length).toLowerCase() === start.toLowerCase();
  const trailingTrimmed = leadingTrimmed.trimEnd();
  const endsWithMarker = trailingTrimmed.slice(-end.length).toLowerCase() === end.toLowerCase();
  return startsWithMarker && endsWithMarker;
};

export const isCodexHookPromptFragment = (text: string): boolean => {
  const trimmed = text.trim();
  return /^<hook_prompt\s+[^>]*hook_run_id="[^"]+"[^>]*>[\s\S]*<\/hook_prompt>$/.test(trimmed);
};

export const isCodexContextualUserTextFragment = (text: string): boolean =>
  isCodexHookPromptFragment(text) ||
  CODEX_CONTEXTUAL_USER_FRAGMENT_MARKERS.some(([start, end]) =>
    textMatchesCodexMarkedContextFragment(text, start, end),
  );

export const codexMessageContentItems = (
  payload: Record<string, unknown>,
): Record<string, unknown>[] => arrayFromUnknown(payload.content).filter(isPlainObject);

export const isCodexContextualUserMessage = (payload: Record<string, unknown>): boolean => {
  const role = extractStringField(payload, ["role"]);
  if (role !== "user") {
    return false;
  }
  const content = codexMessageContentItems(payload);
  return (
    content.length > 0 &&
    content.some((entry) => {
      const text = extractStringField(entry, ["text"]);
      return Boolean(text && isCodexContextualUserTextFragment(text));
    })
  );
};

export const stripShellQuotes = (value: string): string =>
  value.replace(/^[']|^["]/, "").replace(/[']$|["]$/, "");

export const readPathFromCommand = (command: string): string | null => {
  const sedMatch = command.match(/\bsed\s+(?:-n\s+)?['"]?[^'"\s]+['"]?\s+(.+)$/);
  const catMatch = command.match(/\bcat\s+(.+)$/);
  const rawPath = sedMatch?.[1] ?? catMatch?.[1];
  return rawPath ? stripShellQuotes(rawPath.trim()) : null;
};

export const searchInputFromCommand = (command: string): Record<string, unknown> => {
  const input: Record<string, unknown> = { command };
  const rgMatch = command.match(/\brg\s+(?:-[^\s]+\s+)*(?:['"]([^'"]+)['"]|(\S+))(?:\s+(.+))?$/);
  if (!rgMatch) {
    return input;
  }
  const query = rgMatch[1] ?? rgMatch[2];
  const path = rgMatch[3]?.trim();
  if (query) {
    input.query = query;
  }
  if (path) {
    input.path = stripShellQuotes(path);
  }
  return input;
};

export const patchTextFromUnknown = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("*** Begin Patch") || trimmed.includes("\n@@") ? value : null;
};

export const codexNamespacedToolName = (namespace: string | null, tool: string): string => {
  return namespace ? `${namespace}.${tool}` : tool;
};

export const codexToolLeafName = (toolName: string): string => {
  const segments = toolName.split(".").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? toolName;
};

export const isCodexToolNamed = (toolName: string, leafName: string): boolean => {
  return codexToolLeafName(toolName) === leafName;
};

export const isCodexExecCommandTool = (toolName: string): boolean =>
  isCodexToolNamed(toolName, "exec_command");

export const isCodexApplyPatchTool = (toolName: string): boolean =>
  isCodexToolNamed(toolName, "apply_patch");

export const isCodexRequestUserInputTool = (toolName: string): boolean =>
  isCodexToolNamed(toolName, "request_user_input");

export const isCodexWriteStdinTool = (toolName: string): boolean =>
  isCodexToolNamed(toolName, "write_stdin");
