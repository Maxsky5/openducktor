import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { toOdtWorkflowToolDisplayName } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

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

export const SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
};

export const formatTime = (timestamp: string): string => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
};

const compactText = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

export const formatRawJsonLikeText = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
};

export const stripToolPrefix = (tool: string, value: string): string => {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = value.trim();
  return normalized
    .replace(new RegExp(`^Tool\\s+${escaped}\\s*`, "i"), "")
    .replace(/^(queued|running|completed|failed)\s*[:.-]?\s*/i, "")
    .trim();
};

export const toolDisplayName = (tool: string): string => {
  return toOdtWorkflowToolDisplayName(tool);
};

export const toSingleLineMarkdown = (value: string): string => {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const assistantRoleFromMessage = (
  message: AgentChatMessage,
  sessionRole: AgentRole | null,
): AgentRole | null => {
  if (message.role !== "assistant") {
    return null;
  }
  if (message.meta?.kind === "assistant") {
    return message.meta.agentRole;
  }
  return sessionRole;
};

export const roleLabel = (
  role: AgentChatMessage["role"],
  sessionRole: AgentRole | null,
  message: AgentChatMessage,
): string => {
  if (role === "assistant") {
    const assistantRole = assistantRoleFromMessage(message, sessionRole);
    return assistantRole ? AGENT_ROLE_LABEL[assistantRole] : "Assistant";
  }
  if (role === "thinking") {
    return "Thinking";
  }
  if (role === "tool") {
    return "Activity";
  }
  return "System";
};

export const hasNonEmptyInput = (input: Record<string, unknown> | undefined): boolean => {
  if (!input) {
    return false;
  }
  return Object.keys(input).length > 0;
};

export const hasNonEmptyText = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
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
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.trim();
  if (normalized.length === 0 || normalized === ".") {
    return null;
  }
  return normalized;
};

const getTaskSummary = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
): string | null => {
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

export type QuestionToolDetail = {
  prompt: string;
  answers: string[];
};

const parseJsonIfPossible = (value: string | undefined): unknown => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const isQuestionToolName = (tool: string): boolean =>
  tool.toLowerCase() === "question" || tool.toLowerCase().endsWith("_question");

const readQuestionPrompt = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.question,
    record.prompt,
    record.header,
    record.title,
    record.label,
    record.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const normalizeAnswerValues = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeAnswerValues(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return normalizeAnswerValues(
    record.answers ??
      record.answer ??
      record.response ??
      record.responses ??
      record.value ??
      record.text,
  );
};

const collectQuestionDetails = (value: unknown): QuestionToolDetail[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const prompt = readQuestionPrompt(entry);
      if (!prompt) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const answers = normalizeAnswerValues(
        record.answers ?? record.answer ?? record.response ?? record.responses,
      );
      return {
        prompt,
        answers,
      };
    })
    .filter((entry): entry is QuestionToolDetail => entry !== null);
};

const normalizeAnswerGroups = (value: unknown): string[][] => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAnswerValues(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const nested =
    record.answers ??
    record.answer ??
    record.responses ??
    record.response ??
    record.result ??
    record.value;
  if (nested === undefined) {
    const fallback = Object.values(record)
      .map((entry) => normalizeAnswerValues(entry))
      .filter((entry) => entry.length > 0);
    return fallback;
  }
  return normalizeAnswerGroups(nested);
};

const firstNonEmptyAnswerGroups = (candidates: unknown[]): string[][] => {
  for (const candidate of candidates) {
    const groups = normalizeAnswerGroups(candidate)
      .map((entry) => entry.filter((value) => value.trim().length > 0))
      .filter((entry) => entry.length > 0);
    if (groups.length > 0) {
      return groups;
    }
  }
  return [];
};

export const questionToolDetails = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
): QuestionToolDetail[] => {
  if (!isQuestionToolName(meta.tool)) {
    return [];
  }

  const inputQuestions = collectQuestionDetails(meta.input?.questions);
  const metadataQuestions = collectQuestionDetails(meta.metadata?.questions);
  const parsedOutput = parseJsonIfPossible(meta.output);
  const outputQuestions = collectQuestionDetails(
    parsedOutput && typeof parsedOutput === "object"
      ? (parsedOutput as Record<string, unknown>).questions
      : undefined,
  );
  const questions =
    inputQuestions.length > 0
      ? inputQuestions
      : metadataQuestions.length > 0
        ? metadataQuestions
        : outputQuestions;

  if (questions.length === 0) {
    return [];
  }

  const outputRecord =
    parsedOutput && typeof parsedOutput === "object"
      ? (parsedOutput as Record<string, unknown>)
      : undefined;
  const answerGroups = firstNonEmptyAnswerGroups([
    outputRecord,
    outputRecord?.answers,
    outputRecord?.answer,
    outputRecord?.responses,
    outputRecord?.response,
    outputRecord?.result,
    outputRecord?.value,
    meta.metadata,
    meta.metadata?.answers,
    meta.metadata?.answer,
    meta.metadata?.responses,
    meta.metadata?.response,
    meta.input,
    meta.input?.answers,
    meta.input?.answer,
    meta.input?.responses,
    meta.input?.response,
  ]);

  if (answerGroups.length === 0) {
    return questions;
  }

  return questions.map((entry, index) => ({
    prompt: entry.prompt,
    answers: entry.answers.length > 0 ? entry.answers : (answerGroups[index] ?? []),
  }));
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

export const buildToolSummary = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
  content: string,
): string => {
  const lowerTool = meta.tool.toLowerCase();
  const isTodoTool = isTodoToolName(lowerTool);

  if (isTodoTool) {
    const todoCount = countTodosFromOutput(meta.output) ?? countTodosFromInput(meta.input);
    if (todoCount !== null) {
      return `${todoCount} todo${todoCount === 1 ? "" : "s"}`;
    }
    if (meta.status === "running" || meta.status === "pending") {
      return "updating todos";
    }
    if (meta.status === "completed") {
      return "todos updated";
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

export const getToolDuration = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
  messageTimestamp: string,
): number | null => {
  const observedStartedAtMs =
    typeof meta.observedStartedAtMs === "number" ? meta.observedStartedAtMs : null;
  const observedEndedAtMs =
    typeof meta.observedEndedAtMs === "number"
      ? meta.observedEndedAtMs
      : meta.status === "running" || meta.status === "pending"
        ? null
        : Date.parse(messageTimestamp);
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
      : meta.status === "running" || meta.status === "pending"
        ? null
        : Date.parse(messageTimestamp);
  if (endedAtMs === null || Number.isNaN(endedAtMs) || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};

export const getAssistantFooterData = (
  message: AgentChatMessage,
  sessionSelectedModel: AgentModelSelection | null,
): { infoParts: string[] } => {
  if (message.role !== "assistant") {
    return { infoParts: [] };
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const parts: string[] = [];

  const agentLabel = assistantMeta?.opencodeAgent ?? sessionSelectedModel?.opencodeAgent;
  if (typeof agentLabel === "string" && agentLabel.trim().length > 0) {
    parts.push(agentLabel.trim());
  }

  const modelLabel = assistantMeta?.modelId ?? sessionSelectedModel?.modelId;
  if (typeof modelLabel === "string" && modelLabel.trim().length > 0) {
    parts.push(modelLabel.trim());
  }

  return { infoParts: parts };
};
