import type { AgentToolType } from "@openducktor/core";
import { basenameForPath } from "@openducktor/path-support";
import { asUnknownRecord } from "./guards";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";

export const deriveToolType = (toolName: string): AgentToolType => {
  return resolveOpencodeToolStrategy(toolName).toolType;
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
  const lastSegment = basenameForPath(value) || value;
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
  if (tool === "odt_set_pull_request") {
    const providerId = readTrimmedString(input, ["providerId"]);
    const number =
      typeof input?.number === "number" && Number.isFinite(input.number)
        ? `#${input.number}`
        : null;
    const taskId = readTrimmedString(input, ["taskId"]);
    return [taskId, providerId, number].filter((value) => value && value.length > 0).join(" · ");
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
  const strategy = resolveOpencodeToolStrategy(input.tool);
  const tool = strategy.canonicalName;
  const rawInput = asUnknownRecord(input.rawInput);

  let preview: string | null;
  switch (strategy.previewStrategy) {
    case "shell":
      preview = readTrimmedString(rawInput, ["command"]);
      break;
    case "read":
      preview = extractPathFromInput(rawInput);
      break;
    case "list":
      preview = readTrimmedString(rawInput, ["path", "cwd", "directory"]);
      break;
    case "search":
      preview = summarizeSearchInput(tool, rawInput);
      break;
    case "skill":
      preview = summarizeSkillTool(rawInput);
      break;
    case "todo":
      preview = summarizeTodoTool(rawInput, input.rawOutput);
      break;
    case "question":
      preview = summarizeQuestionTool(rawInput, input.metadata, input.rawOutput);
      break;
    case "task":
      preview = summarizeTaskTool(rawInput, input.metadata, input.rawOutput);
      break;
    case "workflow":
      preview =
        tool === "odt_read_task"
          ? summarizeOdtReadTask(rawInput, input.rawOutput)
          : summarizeOdtMutation(tool, rawInput);
      break;
    case "web":
      preview = summarizeWebTool(tool, rawInput);
      break;
    case "context":
      preview = summarizeContextTool(tool, rawInput);
      break;
    case "github_search":
      preview = summarizeGithubSearchTool(rawInput);
      break;
    case "lsp":
      preview = summarizeLspTool(rawInput);
      break;
    case "session":
      preview = summarizeSessionTool(rawInput);
      break;
    case "generic":
      preview = summarizeGenericInput(rawInput);
      break;
  }

  const resolvedPreview = preview ?? summarizeGenericInput(rawInput);
  if (!resolvedPreview) {
    return undefined;
  }
  return compactText(resolvedPreview, tool === "bash" ? 120 : 160);
};
