import type { FileDiff } from "@openducktor/contracts";
import type {
  AgentPendingQuestionRequest,
  AgentStreamPart,
  AgentToolType,
} from "@openducktor/core";
import {
  arrayFromCodexJsonValue,
  codexNamespacedToolName,
  extractStringField,
  isCodexApplyPatchTool,
  isCodexExecCommandTool,
  isPlainObject,
  isCodexRequestUserInputTool,
  isCodexWriteStdinTool,
  readPathFromCommand,
  searchInputFromCommand,
} from "./codex-app-server-shared";
import type { CodexAppServerJsonValue } from "@openducktor/contracts";
import type { CodexToolTimingFields } from "./codex-tool-timing";

/**
 * Canonical boundary for raw Codex tool invocations.
 *
 * Every raw Codex tool name that reaches OpenDucktor transcripts must pass through this module
 * before becoming `AgentStreamPart.tool`. The emitted `tool` keeps the runtime tool identity, and
 * `toolType` carries the OpenDucktor semantic display category.
 *
 * Synthetic display-only parts (for example plan summaries) may be built outside this module
 * because they do not originate from a runtime tool name.
 */

export type AgentToolStatus = Extract<
  import("@openducktor/core").AgentStreamPart,
  { kind: "tool" }
>["status"];

export type CodexToolInvocationMetadata = {
  codexServerRequest?: boolean;
  codexTodoUpdate?: boolean;
  requestId?: string;
  questions?: CodexToolQuestion[];
  answers?: Record<string, { answers: string[] }>;
  server?: string;
};

export type CodexToolQuestion = {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
};

export const toCodexToolQuestions = (
  questions: AgentPendingQuestionRequest["questions"],
): CodexToolQuestion[] =>
  questions.map((question) => {
    const codexQuestion: CodexToolQuestion = {
      header: question.header,
      question: question.question,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
    };
    if (question.multiple !== undefined) {
      codexQuestion.multiple = question.multiple;
    }
    if (question.custom !== undefined) {
      codexQuestion.custom = question.custom;
    }
    return codexQuestion;
  });

export type NormalizedCodexToolInvocation = CodexToolTimingFields & {
  messageId: string;
  partId: string;
  callId: string;
  rawToolName: string;
  namespace?: string;
  status?: string;
  title?: string;
  displayLabel?: string;
  preview?: string;
  input?: Record<string, CodexAppServerJsonValue>;
  output?: string | null;
  error?: string | null;
  fileDiffs?: FileDiff[];
  metadata?: CodexToolInvocationMetadata;
};

export const statusFromCodexStatus = (status: string | undefined): AgentToolStatus => {
  const normalized = status
    ? status
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/-/g, "_")
    : "";
  if (
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "error" ||
    normalized === "declined"
  ) {
    return "error";
  }
  if (normalized === "running" || normalized === "pending" || normalized === "in_progress") {
    return "running";
  }
  return "completed";
};

export const stableToolTitle = (tool: string): string => {
  if (tool === "read") {
    return "Read";
  }
  if (tool === "search") {
    return "Search";
  }
  if (tool === "list") {
    return "List";
  }
  if (tool === "bash") {
    return "Bash";
  }
  if (tool === "apply_patch") {
    return "Apply patch";
  }
  if (tool === "request_user_input") {
    return "Question";
  }
  if (tool === "websearch") {
    return "websearch";
  }
  return tool;
};

const canonicalOdtToolName = (rawToolName: string): string | null => {
  if (rawToolName.startsWith("odt_")) {
    return rawToolName;
  }

  const encodedDotPrefix = "mcp__openducktor__.";
  const encodedPrefix = "mcp__openducktor__";
  if (rawToolName.startsWith(encodedDotPrefix)) {
    const stripped = rawToolName.slice(encodedDotPrefix.length);
    return stripped.startsWith("odt_") ? stripped : null;
  }
  if (rawToolName.startsWith(encodedPrefix)) {
    const stripped = rawToolName.slice(encodedPrefix.length).replace(/^\./, "");
    return stripped.startsWith("odt_") ? stripped : null;
  }

  const openducktorDotPrefix = "openducktor.";
  const openducktorSlashPrefix = "mcp/openducktor/";
  if (rawToolName.startsWith(openducktorDotPrefix)) {
    const stripped = rawToolName.slice(openducktorDotPrefix.length);
    return stripped.startsWith("odt_") ? stripped : null;
  }
  if (rawToolName.startsWith(openducktorSlashPrefix)) {
    const stripped = rawToolName.slice(openducktorSlashPrefix.length);
    return stripped.startsWith("odt_") ? stripped : null;
  }

  return null;
};
const codexToolType = (
  rawToolName: string,
  input?: Record<string, CodexAppServerJsonValue>,
): AgentToolType | null => {
  if (isCodexWriteStdinTool(rawToolName)) {
    return null;
  }

  const odtToolName = canonicalOdtToolName(rawToolName);
  if (odtToolName) {
    return "workflow";
  }

  if (isCodexExecCommandTool(rawToolName)) {
    const command = extractStringField(input, ["cmd", "command"]);
    if (command?.startsWith("sed ") || command?.startsWith("cat ")) {
      return "read";
    }
    if (command?.startsWith("rg ")) {
      return "search";
    }
    return "bash";
  }
  if (rawToolName === "bash") {
    return "bash";
  }
  if (rawToolName === "read") {
    return "read";
  }
  if (rawToolName === "search" || rawToolName === "find") {
    return "search";
  }
  if (rawToolName === "list") {
    return "list";
  }
  if (isCodexApplyPatchTool(rawToolName)) {
    return "file_edit";
  }
  if (isCodexRequestUserInputTool(rawToolName)) {
    return "question";
  }
  if (
    rawToolName === "web.run" ||
    rawToolName === "webSearch" ||
    rawToolName === "web_search" ||
    rawToolName === "web_search_call" ||
    rawToolName === "web_search_end"
  ) {
    return "web";
  }
  const leafToolName = rawToolName.split(/[./]/).filter(Boolean).at(-1) ?? rawToolName;
  if (leafToolName === "update_plan" || leafToolName === "todo_write") {
    return "todo";
  }
  return "generic";
};
const canonicalCodexToolName = (rawToolName: string): string | null => {
  if (isCodexWriteStdinTool(rawToolName)) {
    return null;
  }
  const odtToolName = canonicalOdtToolName(rawToolName);
  if (odtToolName) {
    return odtToolName;
  }
  const functionsPrefix = "functions.";
  return rawToolName.startsWith(functionsPrefix)
    ? rawToolName.slice(functionsPrefix.length)
    : rawToolName;
};

const questionPromptFromInput = (
  input: Record<string, CodexAppServerJsonValue>,
): string | undefined => {
  const questions = arrayFromCodexJsonValue(input.questions).filter(isPlainObject);
  for (const question of questions) {
    const prompt = extractStringField(question, ["question", "prompt", "header", "title"]);
    if (prompt) {
      return prompt;
    }
  }
  return undefined;
};

const toolPreviewFromInput = (
  toolType: AgentToolType,
  input?: Record<string, CodexAppServerJsonValue>,
): string | undefined => {
  if (!input) {
    return undefined;
  }
  const path = extractStringField(input, ["path", "file"]);
  const query = extractStringField(input, ["query", "pattern"]);
  const command = extractStringField(input, ["command"]);
  if (toolType === "read" && path) {
    return path;
  }
  if (toolType === "search") {
    if (query && path) {
      return `${query} in ${path}`;
    }
    return query ?? path ?? command ?? undefined;
  }
  if (toolType === "list") {
    return path ?? command ?? undefined;
  }
  if (toolType === "bash") {
    return command ?? undefined;
  }
  if (toolType === "question") {
    return questionPromptFromInput(input);
  }
  return path ?? query ?? command ?? undefined;
};

type CodexToolInput = Record<string, CodexAppServerJsonValue>;
type CodexReadCommandInput = {
  command: string;
  cwd?: string;
  path?: string;
};
type CodexSearchCommandInput = {
  command: string;
  query?: string;
  path?: string;
  cwd?: string;
};
type CodexShellCommandInput = {
  command: string;
  cwd?: string;
};

const codexExecCommandInput = (input: CodexToolInput, tool: string) => {
  const command = extractStringField(input, ["cmd", "command"]);
  const cwd = extractStringField(input, ["workdir", "cwd"]);
  if (!command) {
    return Object.keys(input).length > 0 ? input : undefined;
  }
  if (tool === "read") {
    const commandInput: CodexReadCommandInput = {
      command,
    };
    if (cwd) {
      commandInput.cwd = cwd;
    }
    const path = readPathFromCommand(command);
    if (path) {
      commandInput.path = path;
    }
    return commandInput;
  }
  if (tool === "search") {
    const searchInput = searchInputFromCommand(command);
    const commandInput: CodexSearchCommandInput = {
      command: searchInput.command,
    };
    if (searchInput.query !== undefined) {
      commandInput.query = searchInput.query;
    }
    if (searchInput.path !== undefined) {
      commandInput.path = searchInput.path;
    }
    if (cwd) {
      commandInput.cwd = cwd;
    }
    return commandInput;
  }
  const commandInput: CodexShellCommandInput = {
    command,
  };
  if (cwd) {
    commandInput.cwd = cwd;
  }
  return commandInput;
};

const normalizerInput = (
  toolType: AgentToolType,
  rawToolName: string,
  input?: Record<string, CodexAppServerJsonValue>,
): Record<string, CodexAppServerJsonValue> | undefined => {
  if (isCodexExecCommandTool(rawToolName)) {
    return codexExecCommandInput(input ?? {}, toolType);
  }
  return input;
};

const defaultTitle = (tool: string): string => {
  return tool.startsWith("odt_") ? tool.slice(4) : stableToolTitle(tool);
};

export const normalizeCodexToolInvocation = ({
  rawToolName,
  input,
  output,
  error,
  fileDiffs,
  title,
  displayLabel,
  preview,
  status,
  metadata,
  namespace,
  ...ids
}: NormalizedCodexToolInvocation): import("@openducktor/core").AgentStreamPart | null => {
  const tool = canonicalCodexToolName(rawToolName);
  const toolType = codexToolType(rawToolName, input);
  if (!tool || !toolType) {
    return null;
  }

  const resolvedInput = normalizerInput(toolType, rawToolName, input);
  const resolvedError = error && error.trim().length > 0 ? error : null;
  const resolvedOutput = output && output.trim().length > 0 ? output : null;
  const resolvedPreview = preview ?? toolPreviewFromInput(toolType, resolvedInput);
  const metadataFields: NonNullable<Extract<AgentStreamPart, { kind: "tool" }>["metadata"]> = {
    ...metadata,
    rawToolName,
  };
  const normalizedTool: Extract<AgentStreamPart, { kind: "tool" }> = {
    kind: "tool",
    ...ids,
    tool,
    toolType,
    title: title ?? defaultTitle(tool),
    status: resolvedError ? "error" : statusFromCodexStatus(status),
    metadata: metadataFields,
  };

  if (displayLabel) {
    normalizedTool.displayLabel = displayLabel;
  }
  if (resolvedInput) {
    normalizedTool.input = resolvedInput;
  }
  if (resolvedPreview) {
    normalizedTool.preview = resolvedPreview;
  }
  if (resolvedOutput) {
    normalizedTool.output = resolvedOutput;
  }
  if (resolvedError) {
    normalizedTool.error = resolvedError;
  }
  if (fileDiffs && fileDiffs.length > 0) {
    normalizedTool.fileDiffs = fileDiffs;
  }
  if (namespace) {
    metadataFields.namespace = namespace;
  }

  return normalizedTool;
};

export const requireNormalizedCodexToolInvocation = (
  invocation: NormalizedCodexToolInvocation,
): import("@openducktor/core").AgentStreamPart => {
  const part = normalizeCodexToolInvocation(invocation);
  if (!part) {
    throw new Error(`Codex tool '${invocation.rawToolName}' is internal and cannot be emitted.`);
  }
  return part;
};

export { codexNamespacedToolName };
