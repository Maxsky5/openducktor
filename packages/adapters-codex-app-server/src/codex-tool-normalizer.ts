import type { FileDiff } from "@openducktor/contracts";
import type { AgentToolType } from "@openducktor/core";
import {
  arrayFromUnknown,
  codexNamespacedToolName,
  extractStringField,
  isCodexApplyPatchTool,
  isCodexExecCommandTool,
  isCodexRequestUserInputTool,
  isCodexWriteStdinTool,
  isPlainObject,
  readPathFromCommand,
  searchInputFromCommand,
} from "./codex-app-server-shared";

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

export type NormalizedCodexToolInvocation = {
  messageId: string;
  partId: string;
  callId: string;
  rawToolName: string;
  namespace?: string;
  status?: unknown;
  title?: string;
  displayLabel?: string;
  preview?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  error?: string | null;
  fileDiffs?: FileDiff[];
  metadata?: Record<string, unknown>;
  startedAtMs?: number;
  endedAtMs?: number;
};

export const statusFromCodexStatus = (status: unknown): AgentToolStatus => {
  const normalized =
    typeof status === "string"
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
  input?: Record<string, unknown>,
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

const questionPromptFromInput = (input: Record<string, unknown>): string | undefined => {
  const questions = arrayFromUnknown(input.questions).filter(isPlainObject);
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
  input?: Record<string, unknown>,
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

const codexExecCommandInput = (
  input: Record<string, unknown>,
  tool: string,
): Record<string, unknown> | undefined => {
  const command = extractStringField(input, ["cmd", "command"]);
  const cwd = extractStringField(input, ["workdir", "cwd"]);
  if (!command) {
    return Object.keys(input).length > 0 ? input : undefined;
  }
  if (tool === "read") {
    return {
      command,
      ...(cwd ? { cwd } : {}),
      ...(readPathFromCommand(command) ? { path: readPathFromCommand(command) } : {}),
    };
  }
  if (tool === "search") {
    return {
      ...searchInputFromCommand(command),
      ...(cwd ? { cwd } : {}),
    };
  }
  return {
    command,
    ...(cwd ? { cwd } : {}),
  };
};

const normalizerInput = (
  toolType: AgentToolType,
  rawToolName: string,
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
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
  return {
    kind: "tool",
    ...ids,
    tool,
    toolType,
    title: title ?? defaultTitle(tool),
    ...(displayLabel ? { displayLabel } : {}),
    status: resolvedError ? "error" : statusFromCodexStatus(status),
    ...(resolvedInput ? { input: resolvedInput } : {}),
    ...(resolvedPreview ? { preview: resolvedPreview } : {}),
    ...(resolvedOutput ? { output: resolvedOutput } : {}),
    ...(resolvedError ? { error: resolvedError } : {}),
    ...(fileDiffs && fileDiffs.length > 0 ? { fileDiffs } : {}),
    metadata: {
      ...(metadata ?? {}),
      rawToolName,
      ...(namespace ? { namespace } : {}),
    },
  };
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
