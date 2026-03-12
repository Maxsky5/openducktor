import { asUnknownRecord } from "./guards";

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec", "command"]);
const READ_TOOL_NAMES = new Set(["read", "cat", "view"]);
const LIST_TOOL_NAMES = new Set(["list", "ls"]);
const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "find", "search", "ast_grep_search"]);
const TODO_TOOL_NAMES = new Set(["todowrite", "todoread"]);
const TASK_TOOL_NAMES = new Set(["task", "delegate", "subtask"]);
const SESSION_TOOL_NAMES = new Set([
  "session_info",
  "session_list",
  "session_read",
  "session_search",
]);
const LSP_TOOL_NAMES = new Set([
  "lsp_diagnostic",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_symbols",
]);

const normalizeToolName = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withoutFunctionsNamespace = trimmed.startsWith("functions.")
    ? trimmed.slice("functions.".length)
    : trimmed;
  return withoutFunctionsNamespace.startsWith("openducktor_odt_")
    ? withoutFunctionsNamespace.slice("openducktor_".length)
    : withoutFunctionsNamespace;
};

const compactText = (value: string, maxLength = 160): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const readTrimmedString = (
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | null => {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const extractPathFromInput = (input: Record<string, unknown> | undefined): string | null => {
  return readTrimmedString(input, ["filePath", "file_path", "path", "file", "filename"]);
};

const extractBaseName = (value: string): string => {
  const normalized = value.replace(/\\/g, "/");
  const lastSegment = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return lastSegment.replace(/\.[^.]+$/, "");
};

const summarizeSearchInput = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (!input) {
    return null;
  }
  const pattern = readTrimmedString(input, [
    "pattern",
    "query",
    "regex",
    "glob",
    "expression",
    "name",
    "rule",
  ]);
  const path = readTrimmedString(input, ["path", "cwd", "directory", "root", "basePath"]);
  const normalizedPath = path && path !== "." ? path : null;

  if (pattern && normalizedPath) {
    return `${pattern} in ${normalizedPath}`;
  }
  if (pattern) {
    return pattern;
  }
  if (normalizedPath) {
    return normalizedPath;
  }
  if (tool === "find" && path === ".") {
    return "workspace";
  }
  return null;
};

const countCollectionItems = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }
  if (Array.isArray(record.todos)) {
    return record.todos.length;
  }
  if (Array.isArray(record.items)) {
    return record.items.length;
  }
  if (Array.isArray(record.questions)) {
    return record.questions.length;
  }
  if (Array.isArray(record.summary)) {
    return record.summary.length;
  }
  return null;
};

const summarizeTodoTool = (
  input: Record<string, unknown> | undefined,
  output: unknown,
): string | null => {
  const count = countCollectionItems(output) ?? countCollectionItems(input?.todos ?? input?.items);
  if (count === null) {
    return null;
  }
  return `${count} todo${count === 1 ? "" : "s"}`;
};

const summarizeQuestionTool = (
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  output: unknown,
): string | null => {
  const sources = [input, metadata, asUnknownRecord(output)];
  for (const source of sources) {
    const questions = source?.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      continue;
    }
    const firstQuestion = asUnknownRecord(questions[0]);
    const prompt = readTrimmedString(firstQuestion, ["question", "prompt", "label"]);
    if (prompt) {
      return prompt;
    }
    return `${questions.length} question${questions.length === 1 ? "" : "s"}`;
  }
  return null;
};

const summarizeTaskTool = (
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  output: unknown,
): string | null => {
  const summaryCount = countCollectionItems(metadata?.summary);
  if (summaryCount !== null) {
    return `${summaryCount} subagent result${summaryCount === 1 ? "" : "s"}`;
  }

  const sessionId = readTrimmedString(metadata, ["sessionId"]);
  if (sessionId) {
    return `Subagent session ${sessionId.slice(0, 8)}`;
  }

  return (
    readTrimmedString(input, ["agent", "description", "prompt"]) ??
    readTrimmedString(asUnknownRecord(output), ["message", "result", "description"])
  );
};

const summarizeOdtReadTask = (
  input: Record<string, unknown> | undefined,
  output: unknown,
): string | null => {
  const taskId = readTrimmedString(input, ["taskId"]);
  if (taskId) {
    return taskId;
  }

  const outputRecord = asUnknownRecord(output);
  const taskRecord =
    asUnknownRecord(outputRecord?.task) ??
    asUnknownRecord(asUnknownRecord(outputRecord?.structuredContent)?.task);
  const title = readTrimmedString(taskRecord, ["title", "name"]);
  if (title) {
    return title;
  }
  return null;
};

const summarizeOdtMutation = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (tool === "odt_build_blocked") {
    return readTrimmedString(input, ["reason", "taskId"]);
  }
  if (tool === "odt_build_completed") {
    return readTrimmedString(input, ["summary", "taskId"]);
  }
  if (tool === "odt_set_plan") {
    const subtaskCount = countCollectionItems(input?.subtasks);
    if (subtaskCount !== null) {
      const taskId = readTrimmedString(input, ["taskId"]);
      return taskId
        ? `${taskId} · ${subtaskCount} subtask${subtaskCount === 1 ? "" : "s"}`
        : `${subtaskCount} subtask${subtaskCount === 1 ? "" : "s"}`;
    }
  }
  return readTrimmedString(input, ["taskId"]);
};

const summarizeSkillTool = (input: Record<string, unknown> | undefined): string | null => {
  const direct =
    readTrimmedString(input, ["name", "skillName", "skill", "id"]) ??
    readTrimmedString(asUnknownRecord(input?.skill), ["name", "id"]);
  if (direct) {
    return direct;
  }

  const path = readTrimmedString(input, ["path", "filePath"]);
  return path ? extractBaseName(path) : null;
};

const summarizeWebTool = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (tool === "webfetch") {
    return readTrimmedString(input, ["url", "href"]);
  }
  return readTrimmedString(input, ["query", "q", "url"]);
};

const summarizeContextTool = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (tool === "context7_resolve-library-id") {
    return readTrimmedString(input, ["libraryName", "query"]);
  }
  if (tool === "context7_query-docs") {
    return readTrimmedString(input, ["query", "libraryId"]);
  }
  return null;
};

const summarizeGithubSearchTool = (input: Record<string, unknown> | undefined): string | null => {
  const query = readTrimmedString(input, ["query"]);
  const repo = readTrimmedString(input, ["repo"]);
  if (query && repo) {
    return `${query} in ${repo}`;
  }
  return query ?? repo;
};

const summarizeLspTool = (input: Record<string, unknown> | undefined): string | null => {
  return (
    readTrimmedString(input, ["symbol", "name", "query"]) ??
    extractPathFromInput(input) ??
    readTrimmedString(input, ["word"])
  );
};

const summarizeSessionTool = (input: Record<string, unknown> | undefined): string | null => {
  return (
    readTrimmedString(input, ["sessionId", "query"]) ?? readTrimmedString(input, ["id", "name"])
  );
};

const summarizeGenericInput = (input: Record<string, unknown> | undefined): string | null => {
  return (
    readTrimmedString(input, ["url", "query", "pattern", "symbol", "libraryId", "libraryName"]) ??
    extractPathFromInput(input) ??
    readTrimmedString(input, ["name", "id", "prompt", "description"])
  );
};

export const deriveToolPreview = (input: {
  tool: string;
  rawInput: unknown;
  rawOutput: unknown;
  metadata?: Record<string, unknown>;
}): string | undefined => {
  const tool = normalizeToolName(input.tool);
  const rawInput = asUnknownRecord(input.rawInput);

  const preview =
    (SHELL_TOOL_NAMES.has(tool) ? readTrimmedString(rawInput, ["command"]) : null) ??
    (READ_TOOL_NAMES.has(tool) ? extractPathFromInput(rawInput) : null) ??
    (LIST_TOOL_NAMES.has(tool)
      ? (readTrimmedString(rawInput, ["path", "cwd", "directory"]) ?? null)
      : null) ??
    (SEARCH_TOOL_NAMES.has(tool) ? summarizeSearchInput(tool, rawInput) : null) ??
    ((tool === "skill" && summarizeSkillTool(rawInput)) || null) ??
    (TODO_TOOL_NAMES.has(tool) || tool.endsWith("_todowrite") || tool.endsWith("_todoread")
      ? summarizeTodoTool(rawInput, input.rawOutput)
      : null) ??
    (tool === "question" || tool.endsWith("_question")
      ? summarizeQuestionTool(rawInput, input.metadata, input.rawOutput)
      : null) ??
    (TASK_TOOL_NAMES.has(tool)
      ? summarizeTaskTool(rawInput, input.metadata, input.rawOutput)
      : null) ??
    (tool === "odt_read_task" ? summarizeOdtReadTask(rawInput, input.rawOutput) : null) ??
    (tool.startsWith("odt_") ? summarizeOdtMutation(tool, rawInput) : null) ??
    (tool === "webfetch" || tool.startsWith("websearch")
      ? summarizeWebTool(tool, rawInput)
      : null) ??
    (tool.startsWith("context7_") ? summarizeContextTool(tool, rawInput) : null) ??
    (tool === "grep_app_searchgithub" ? summarizeGithubSearchTool(rawInput) : null) ??
    (LSP_TOOL_NAMES.has(tool) ? summarizeLspTool(rawInput) : null) ??
    (SESSION_TOOL_NAMES.has(tool) ? summarizeSessionTool(rawInput) : null) ??
    summarizeGenericInput(rawInput);

  if (!preview) {
    return undefined;
  }
  return compactText(preview, tool === "bash" ? 120 : 160);
};
