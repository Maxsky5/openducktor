import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { stripToolPrefix } from "./message-formatting";
import { getToolLifecyclePhase, hasNonEmptyInput, hasNonEmptyText } from "./tool-lifecycle";

const OUTPUT_IGNORED_TOOL_NAMES = new Set([
  "read",
  "glob",
  "grep",
  "find",
  "search",
  "list",
  "ls",
  "distill",
]);

const REGULAR_TOOL_SUMMARY_FROM_OUTPUT_TOOL_NAMES = new Set(["task", "subtask", "delegate"]);

const compactText = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const readInputString = (
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | null => {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const summarizeSearchToolInput = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (!input) {
    return null;
  }
  const pattern = readInputString(input, [
    "pattern",
    "query",
    "regex",
    "glob",
    "expression",
    "name",
  ]);
  const path = readInputString(input, ["path", "cwd", "directory", "root", "basePath"]);
  const normalizedPath = path && path !== "." ? path : null;

  if (tool === "glob" && pattern && normalizedPath) {
    return `${pattern} in ${normalizedPath}`;
  }
  if ((tool === "glob" || tool === "grep" || tool === "find" || tool === "search") && pattern) {
    return normalizedPath ? `${pattern} in ${normalizedPath}` : pattern;
  }
  if (normalizedPath) {
    return normalizedPath;
  }
  if (path === ".") {
    return "workspace";
  }
  return null;
};

const extractPathFromInput = (input: Record<string, unknown> | undefined): string | null => {
  const candidate =
    input?.filePath ?? input?.file_path ?? input?.path ?? input?.file ?? input?.filename;
  if (typeof candidate === "string") {
    const normalized = candidate.trim();
    if (normalized.length > 0 && normalized !== ".") {
      return normalized;
    }
  }
  return null;
};

const getTaskSummary = (meta: ToolMeta): string | null => {
  const summary = meta.metadata?.summary;
  if (Array.isArray(summary)) {
    return `${summary.length} subagent tool step${summary.length === 1 ? "" : "s"}`;
  }
  const sessionId = meta.metadata?.sessionId;
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    return `Subagent session ${sessionId.slice(0, 8)}`;
  }
  return null;
};

const parseStructuredOutputSummary = (output: string): string | null => {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length > 0
        ? `${parsed.length} subagent result${parsed.length === 1 ? "" : "s"}`
        : null;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.summary)) {
      return `${record.summary.length} subagent result${record.summary.length === 1 ? "" : "s"}`;
    }

    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return compactText(record.message, 160);
    }

    if (typeof record.result === "string" && record.result.trim().length > 0) {
      return compactText(record.result, 160);
    }

    return null;
  } catch {
    return null;
  }
};

const isTodoToolName = (tool: string): boolean => {
  return (
    tool === "todowrite" ||
    tool === "todoread" ||
    tool.endsWith("_todowrite") ||
    tool.endsWith("_todoread")
  );
};

const countTodosFromUnknown = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.todos)) {
    return record.todos.length;
  }
  if (Array.isArray(record.items)) {
    return record.items.length;
  }
  return null;
};

const countTodosFromInput = (input: Record<string, unknown> | undefined): number | null => {
  if (!input) {
    return null;
  }
  return countTodosFromUnknown(input.todos ?? input.items ?? null);
};

const countTodosFromOutput = (output: string | undefined): number | null => {
  if (!output || output.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    return countTodosFromUnknown(parsed);
  } catch {
    return null;
  }
};

export const buildToolSummary = (meta: ToolMeta, content: string): string => {
  const lowerTool = meta.tool.toLowerCase();
  const isTodoTool = isTodoToolName(lowerTool);
  const lifecyclePhase = getToolLifecyclePhase(meta);

  if (isTodoTool) {
    const todoCount = countTodosFromOutput(meta.output) ?? countTodosFromInput(meta.input);
    if (todoCount !== null) {
      return `${todoCount} todo${todoCount === 1 ? "" : "s"}`;
    }
    if (lifecyclePhase === "queued" || lifecyclePhase === "executing") {
      return "updating todos";
    }
    if (lifecyclePhase === "completed") {
      return "todos updated";
    }
    if (lifecyclePhase === "cancelled") {
      return "todos update cancelled";
    }
  }

  if (lowerTool === "task") {
    const taskSummary = getTaskSummary(meta);
    if (taskSummary) {
      return taskSummary;
    }
  }

  if (meta.status === "error" && hasNonEmptyText(meta.error)) {
    return compactText(meta.error, 220);
  }

  if (meta.title && meta.title.trim().length > 0) {
    return compactText(meta.title, 160);
  }

  const path = extractPathFromInput(meta.input);
  const searchSummary = summarizeSearchToolInput(lowerTool, meta.input);
  if (searchSummary) {
    return compactText(searchSummary, 160);
  }
  if (path && lowerTool !== "glob" && lowerTool !== "grep") {
    return compactText(path, 160);
  }

  const command = meta.input?.command;
  if (lowerTool === "bash" && typeof command === "string" && command.trim().length > 0) {
    return compactText(command, 120);
  }

  if (!OUTPUT_IGNORED_TOOL_NAMES.has(lowerTool) && hasNonEmptyText(meta.output)) {
    if (REGULAR_TOOL_SUMMARY_FROM_OUTPUT_TOOL_NAMES.has(lowerTool)) {
      const structured = parseStructuredOutputSummary(meta.output);
      if (structured) {
        return structured;
      }
    }
    return compactText(meta.output, 160);
  }

  const fromContent = stripToolPrefix(meta.tool, content);
  if (fromContent.length > 0) {
    return compactText(fromContent, 160);
  }

  return "";
};

export const getToolDuration = (meta: ToolMeta, messageTimestamp: string): number | null => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  if (lifecyclePhase === "queued" || lifecyclePhase === "executing") {
    return null;
  }

  const parsedMessageTimestamp = Date.parse(messageTimestamp);
  const completionAtMs =
    typeof meta.observedEndedAtMs === "number"
      ? meta.observedEndedAtMs
      : typeof meta.endedAtMs === "number"
        ? meta.endedAtMs
        : Number.isNaN(parsedMessageTimestamp)
          ? null
          : parsedMessageTimestamp;
  const inputReadyAtMs =
    typeof meta.inputReadyAtMs === "number"
      ? meta.inputReadyAtMs
      : hasNonEmptyInput(meta.input)
        ? typeof meta.observedStartedAtMs === "number"
          ? meta.observedStartedAtMs
          : typeof meta.startedAtMs === "number"
            ? meta.startedAtMs
            : null
        : null;
  if (completionAtMs !== null && inputReadyAtMs !== null && completionAtMs >= inputReadyAtMs) {
    return completionAtMs - inputReadyAtMs;
  }

  const observedStartedAtMs =
    typeof meta.observedStartedAtMs === "number" ? meta.observedStartedAtMs : null;
  const observedEndedAtMs =
    typeof meta.observedEndedAtMs === "number"
      ? meta.observedEndedAtMs
      : Number.isNaN(parsedMessageTimestamp)
        ? null
        : parsedMessageTimestamp;
  if (
    observedStartedAtMs !== null &&
    observedEndedAtMs !== null &&
    !Number.isNaN(observedEndedAtMs) &&
    observedEndedAtMs >= observedStartedAtMs
  ) {
    return observedEndedAtMs - observedStartedAtMs;
  }

  if (typeof meta.startedAtMs !== "number") {
    return null;
  }
  const endedAtMs =
    typeof meta.endedAtMs === "number"
      ? meta.endedAtMs
      : Number.isNaN(parsedMessageTimestamp)
        ? null
        : parsedMessageTimestamp;
  if (endedAtMs === null || Number.isNaN(endedAtMs) || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};

const FILE_EDIT_TOOLS = new Set([
  "edit",
  "multiedit",
  "write",
  "create",
  "file_write",
  "apply_patch",
  "str_replace",
  "str_replace_based_edit_tool",
  "patch",
  "insert",
  "replace",
]);

export const isFileEditTool = (toolName: string): boolean => {
  return FILE_EDIT_TOOLS.has(toolName.toLowerCase());
};

export type FileEditData = {
  filePath: string;
  diff: string | null;
  additions: number;
  deletions: number;
};

export const extractFileEditData = (meta: ToolMeta): FileEditData | null => {
  let filePath = extractPathFromInput(meta.input);

  if (!filePath && typeof meta.input?.patch === "string") {
    const patchContent = meta.input.patch as string;
    const diffMatch = /^---\s+a\/(.+)$/m.exec(patchContent);
    if (diffMatch?.[1]) {
      filePath = diffMatch[1];
    }
  }

  if (!filePath && typeof meta.output === "string") {
    const outputFileMatch =
      /(?:Updated|Modified|Created|Changed)[^:]*:\s*(?:[MADRCU]\s+)?(.+?)$/m.exec(meta.output);
    if (outputFileMatch?.[1]) {
      filePath = outputFileMatch[1].trim();
    }
  }

  if (!filePath) {
    return null;
  }

  const diff =
    typeof meta.metadata?.diff === "string"
      ? meta.metadata.diff
      : typeof meta.input?.patch === "string"
        ? (meta.input.patch as string)
        : typeof meta.output === "string" && meta.output.includes("@@")
          ? meta.output
          : null;

  let additions = 0;
  let deletions = 0;
  if (diff) {
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
  }

  return { filePath, diff, additions, deletions };
};
