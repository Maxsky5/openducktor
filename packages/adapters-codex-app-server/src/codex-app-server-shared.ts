import { z } from "zod";
import type { AgentModelSelection } from "@openducktor/core";
import type { CodexAppServerThreadItem, CodexAppServerJsonValue } from "@openducktor/contracts";
import type { CodexSessionState, CodexTurnStartResult, CodexUserInput } from "./types";

export const unsupported = (surface: string): never => {
  throw new Error(`Codex App Server adapter does not support ${surface}.`);
};

const codexStringValueSchema = z.string();

export const isPlainObject = (
  value: CodexAppServerJsonValue | undefined,
): value is Record<string, CodexAppServerJsonValue> => {
  if (value === undefined || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const CODEX_USER_INPUT_REQUEST_METHOD = "item/tool/requestUserInput";

export type ActiveCodexTurn = {
  session: CodexSessionState;
  startedAtMs: number;
  turnStartRequestSentAtMs: number | null;
  turnStartPromise: Promise<CodexTurnStartResult> | null;
  isTurnSettled: () => boolean;
  markTurnSettled: () => void;
  handledRequestKeys: Set<string>;
  queuedUserMessages: CodexUserInput[][];
  model: AgentModelSelection;
  turnId?: string;
};

export type CodexLiveEventPump = {
  unsubscribe: (() => void) | null;
  ready: Promise<void>;
};

export const MAX_CODEX_EVENT_BACKLOG_PER_SESSION = 500;
export const MAX_CODEX_BUFFERED_THREAD_COUNT = 100;
export const CODEX_MODEL_CATALOG_TTL_MS = 5 * 60_000;

export const readCodexString = (value: CodexAppServerJsonValue | undefined): string | null => {
  const parsed = codexStringValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const readNonEmptyCodexString = (
  value: CodexAppServerJsonValue | undefined,
): string | null => {
  const text = readCodexString(value);
  if (text === null) {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseCodexJsonObjectString = (
  value: CodexAppServerJsonValue | undefined,
): Record<string, CodexAppServerJsonValue> | null => {
  const text = readCodexString(value);
  if (text === null) {
    return null;
  }

  try {
    const parsed = z.json().safeParse(JSON.parse(text));
    return parsed.success && isPlainObject(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
};

export const trimOldestMapKeys = <Value>(map: Map<string, Value>, maxSize: number): void => {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      return;
    }
    map.delete(oldestKey);
  }
};
export const isCodexUnmaterializedThreadError = (cause: unknown): boolean => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const inlineTurnsUnavailable =
    message.includes("is not materialized yet") &&
    message.includes("includeTurns is unavailable before first user message");
  const paginatedTurnsUnavailable = message.includes(
    "thread/turns/list is unavailable before first user message",
  );
  return inlineTurnsUnavailable || paginatedTurnsUnavailable;
};

export const isCodexThreadNotLoadedError = (cause: unknown): boolean => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("thread not loaded:");
};

export const extractStringField = (
  value: CodexAppServerJsonValue | undefined,
  keys: string[],
): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = readNonEmptyCodexString(value[key]);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
};

export const arrayFromCodexJsonValue = (
  value: CodexAppServerJsonValue | undefined,
): CodexAppServerJsonValue[] => {
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

export const stringifyJsonValue = (value: CodexAppServerJsonValue | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = readCodexString(value);
  if (text !== null) {
    return text;
  }
  return JSON.stringify(value, null, 2);
};

const CODEX_CONTEXTUAL_USER_FRAGMENT_MARKERS = [
  ["# AGENTS.md instructions for ", "</INSTRUCTIONS>"],
  ["<environment_context>", "</environment_context>"],
  ["<skill>", "</skill>"],
  ["<user_shell_command>", "</user_shell_command>"],
  ["<turn_aborted>", "</turn_aborted>"],
  ["<subagent_notification>", "</subagent_notification>"],
] as const;

const textMatchesCodexMarkedContextFragment = (
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

const isCodexHookPromptFragment = (text: string): boolean => {
  const trimmed = text.trim();
  return /^<hook_prompt\s+[^>]*hook_run_id="[^"]+"[^>]*>[\s\S]*<\/hook_prompt>$/.test(trimmed);
};

const isCodexContextualUserTextFragment = (text: string): boolean =>
  isCodexHookPromptFragment(text) ||
  CODEX_CONTEXTUAL_USER_FRAGMENT_MARKERS.some(([start, end]) =>
    textMatchesCodexMarkedContextFragment(text, start, end),
  );

type CodexUserMessageItem = Extract<CodexAppServerThreadItem, { type: "userMessage" }>;

export const isCodexContextualUserMessage = (payload: CodexUserMessageItem): boolean =>
  payload.content.some(
    (entry) => entry.type === "text" && isCodexContextualUserTextFragment(entry.text),
  );

const stripShellQuotes = (value: string): string =>
  value.replace(/^[']|^["]/, "").replace(/[']$|["]$/, "");

type SearchCommandInput = {
  command: string;
  query?: string;
  path?: string;
};

export const readPathFromCommand = (command: string): string | null => {
  const sedMatch = command.match(/\bsed\s+(?:-n\s+)?['"]?[^'"\s]+['"]?\s+(.+)$/);
  const catMatch = command.match(/\bcat\s+(.+)$/);
  const rawPath = sedMatch?.[1] ?? catMatch?.[1];
  return rawPath ? stripShellQuotes(rawPath.trim()) : null;
};

export const searchInputFromCommand = (command: string): SearchCommandInput => {
  const input: SearchCommandInput = { command };
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

export const codexNamespacedToolName = (namespace: string | null, tool: string): string => {
  return namespace ? `${namespace}.${tool}` : tool;
};

const codexToolLeafName = (toolName: string): string => {
  const segments = toolName.split(".").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? toolName;
};

const isCodexToolNamed = (toolName: string, leafName: string): boolean => {
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
