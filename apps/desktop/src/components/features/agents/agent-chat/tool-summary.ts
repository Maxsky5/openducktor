import { isTodoToolName } from "@/state/operations/agent-orchestrator/agent-tool-messages";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { extractAllFileEditData, isFileEditTool } from "./file-edit-tool";
import { extractPathFromInput, readInputString } from "./tool-input-utils";
import { getToolLifecyclePhase, hasNonEmptyText } from "./tool-lifecycle";
import { relativizeDisplayPath, relativizeSearchSummary } from "./tool-path-utils";
import { compactText, stripToolPrefix } from "./tool-text-utils";

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

const SEARCH_PATH_DISPLAY_TOOL_NAMES = new Set([
  "glob",
  "grep",
  "find",
  "search",
  "ast_grep_search",
]);

const PATH_DISPLAY_TOOL_NAMES = new Set([
  "read",
  "cat",
  "view",
  "list",
  "ls",
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
  "lsp_diagnostic",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_symbols",
  "look_at",
]);

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

const parseStructuredOutputSummary = (output: string): string | null => {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
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

const normalizeDisplaySummary = (
  tool: string,
  summary: string,
  workingDirectory?: string | null,
): string => {
  if (SEARCH_PATH_DISPLAY_TOOL_NAMES.has(tool)) {
    return relativizeSearchSummary(summary, workingDirectory);
  }
  if (!PATH_DISPLAY_TOOL_NAMES.has(tool)) {
    return summary;
  }
  return relativizeDisplayPath(summary, workingDirectory);
};

const extractTaskId = (input: Record<string, unknown> | undefined): string | null => {
  const taskId = input?.taskId;
  return typeof taskId === "string" && taskId.trim().length > 0 ? taskId.trim() : null;
};

export const buildToolSummary = (
  meta: ToolMeta,
  content: string,
  workingDirectory?: string | null,
): string => {
  const lowerTool = meta.tool.toLowerCase();
  const isTodoTool = isTodoToolName(lowerTool);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const fileEditData = isFileEditTool(lowerTool)
    ? extractAllFileEditData(meta, workingDirectory)
    : [];

  if (
    lowerTool === "read_task" ||
    lowerTool === "odt_read_task" ||
    lowerTool.endsWith("_odt_read_task")
  ) {
    if (meta.status === "error" && hasNonEmptyText(meta.error)) {
      return compactText(meta.error, 220);
    }
    const taskId = extractTaskId(meta.input);
    if (taskId) {
      return taskId;
    }
  }

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

  if (meta.status === "error" && hasNonEmptyText(meta.error)) {
    return compactText(meta.error, 220);
  }

  if (lifecyclePhase === "completed" && fileEditData.length > 0) {
    return "";
  }

  if (typeof meta.preview === "string" && meta.preview.trim().length > 0) {
    return compactText(normalizeDisplaySummary(lowerTool, meta.preview, workingDirectory), 160);
  }

  if (meta.title && meta.title.trim().length > 0) {
    return compactText(normalizeDisplaySummary(lowerTool, meta.title, workingDirectory), 160);
  }

  const path = extractPathFromInput(meta.input);
  const searchSummary = summarizeSearchToolInput(lowerTool, meta.input);
  if (searchSummary) {
    return compactText(relativizeSearchSummary(searchSummary, workingDirectory), 160);
  }

  if (fileEditData.length > 1) {
    return lifecyclePhase === "completed"
      ? `${fileEditData.length} files modified`
      : `${fileEditData.length} files`;
  }

  const singleFileEditData = fileEditData[0];
  if (singleFileEditData) {
    return compactText(singleFileEditData.filePath, 160);
  }

  if (path && lowerTool !== "glob" && lowerTool !== "grep") {
    return compactText(relativizeDisplayPath(path, workingDirectory), 160);
  }

  const command = meta.input?.command;
  if (lowerTool === "bash" && typeof command === "string" && command.trim().length > 0) {
    return compactText(command, 120);
  }

  if (!OUTPUT_IGNORED_TOOL_NAMES.has(lowerTool) && hasNonEmptyText(meta.output)) {
    const structured = parseStructuredOutputSummary(meta.output);
    if (structured) {
      return structured;
    }
    return compactText(meta.output, 160);
  }

  const fromContent = stripToolPrefix(meta.tool, content);
  if (fromContent.length > 0) {
    return compactText(fromContent, 160);
  }

  return "";
};
