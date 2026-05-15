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
 * before becoming `AgentStreamPart.tool`. The frontend receives OpenDucktor semantic tool names
 * (`odt_set_spec`, `websearch`, `read`, `bash`, ...), while raw Codex names remain metadata.
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
  preview?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
  startedAtMs?: number;
  endedAtMs?: number;
};

export const statusFromCodexStatus = (status: unknown): AgentToolStatus => {
  const normalized = typeof status === "string" ? status.toLowerCase().replace(/-/g, "_") : "";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") {
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

export const canonicalCodexToolName = (
  rawToolName: string,
  input?: Record<string, unknown>,
): string | null => {
  if (isCodexWriteStdinTool(rawToolName)) {
    return null;
  }

  const odtToolName = canonicalOdtToolName(rawToolName);
  if (odtToolName) {
    return odtToolName;
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
  if (isCodexApplyPatchTool(rawToolName)) {
    return "apply_patch";
  }
  if (isCodexRequestUserInputTool(rawToolName)) {
    return "request_user_input";
  }
  if (
    rawToolName === "web.run" ||
    rawToolName === "webSearch" ||
    rawToolName === "web_search" ||
    rawToolName === "web_search_call" ||
    rawToolName === "web_search_end"
  ) {
    return "websearch";
  }
  const leafToolName = rawToolName.split(/[./]/).filter(Boolean).at(-1) ?? rawToolName;
  if (leafToolName === "update_plan" || leafToolName === "todo_write") {
    return leafToolName;
  }
  return rawToolName;
};

export const questionPromptFromInput = (input: Record<string, unknown>): string | undefined => {
  const questions = arrayFromUnknown(input.questions).filter(isPlainObject);
  for (const question of questions) {
    const prompt = extractStringField(question, ["question", "prompt", "header", "title"]);
    if (prompt) {
      return prompt;
    }
  }
  return undefined;
};

export const toolPreviewFromInput = (
  tool: string,
  input?: Record<string, unknown>,
): string | undefined => {
  if (!input) {
    return undefined;
  }
  const path = extractStringField(input, ["path", "file"]);
  const query = extractStringField(input, ["query", "pattern"]);
  const command = extractStringField(input, ["command"]);
  if (tool === "read" && path) {
    return path;
  }
  if (tool === "search" || tool === "find") {
    if (query && path) {
      return `${query} in ${path}`;
    }
    return query ?? path ?? command ?? undefined;
  }
  if (tool === "list") {
    return path ?? command ?? undefined;
  }
  if (tool === "bash") {
    return command ?? undefined;
  }
  if (tool === "request_user_input") {
    return questionPromptFromInput(input);
  }
  return path ?? query ?? command ?? undefined;
};

export const codexExecCommandInput = (
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
  tool: string,
  rawToolName: string,
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (isCodexExecCommandTool(rawToolName)) {
    return codexExecCommandInput(input ?? {}, tool);
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
  title,
  preview,
  status,
  metadata,
  namespace,
  ...ids
}: NormalizedCodexToolInvocation): import("@openducktor/core").AgentStreamPart | null => {
  const tool = canonicalCodexToolName(rawToolName, input);
  if (!tool) {
    return null;
  }

  const resolvedInput = normalizerInput(tool, rawToolName, input);
  const resolvedError = error && error.trim().length > 0 ? error : null;
  const resolvedOutput = output && output.trim().length > 0 ? output : null;
  const resolvedPreview = preview ?? toolPreviewFromInput(tool, resolvedInput);
  return {
    kind: "tool",
    ...ids,
    tool,
    title: title ?? defaultTitle(tool),
    status: resolvedError ? "error" : statusFromCodexStatus(status),
    ...(resolvedInput ? { input: resolvedInput } : {}),
    ...(resolvedPreview ? { preview: resolvedPreview } : {}),
    ...(resolvedOutput ? { output: resolvedOutput } : {}),
    ...(resolvedError ? { error: resolvedError } : {}),
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
