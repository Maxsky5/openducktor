import { jsonObjectSchema, type JsonObject } from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import { type ClaudeFailureDetails, readStringProp } from "./claude-agent-sdk-utils";
import type { ClaudeDecodedToolResult, ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";

type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ClaudeTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "paused"
  | undefined;

export type ClaudeAgentResult = JsonObject;

export const claudeSubagentStatusFromTaskStatus = (
  status: ClaudeTaskStatus,
): SubagentStreamPart["status"] => {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "killed") {
    return "cancelled";
  }
  return "running";
};

export const isTerminalClaudeTaskStatus = (status: ClaudeTaskStatus): boolean =>
  status === "completed" || status === "failed" || status === "killed";

export const readStructuredClaudeAgentResult = (
  raw: ClaudeDecodedToolResult["raw"],
): ClaudeAgentResult => {
  const toolUseResult = jsonObjectSchema.safeParse(raw.toolUseResult);
  if (toolUseResult.success) {
    return toolUseResult.data;
  }
  const structuredContent = jsonObjectSchema.safeParse(raw.structuredContent);
  if (structuredContent.success) {
    return structuredContent.data;
  }
  return raw;
};

export const claudeAgentResultStatus = (
  result: ClaudeAgentResult,
  isError: boolean,
): SubagentStreamPart["status"] => {
  if (isError) {
    return "error";
  }
  const status = readStringProp(result, "status");
  if (
    status === "async_launched" ||
    status === "remote_launched" ||
    status === "running" ||
    status === "pending"
  ) {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (status === "cancelled" || status === "canceled" || status === "killed") {
    return "cancelled";
  }
  return "completed";
};

export const claudeAgentResultExecutionMode = (
  result: ClaudeAgentResult,
  input: ClaudeDecodedToolUse["input"],
): NonNullable<SubagentStreamPart["executionMode"]> => {
  const status = readStringProp(result, "status");
  if (status === "async_launched" || status === "remote_launched") {
    return "background";
  }
  return input?.run_in_background === true ? "background" : "foreground";
};

export const firstClaudeTaskText = (
  ...values: Array<string | undefined | null>
): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
};

export const readClaudeFailedTaskMessage = (
  value: ClaudeAgentResult | ClaudeFailureDetails,
): string | undefined =>
  firstClaudeTaskText(
    readStringProp(value, "error"),
    readStringProp(value, "message"),
    readStringProp(value, "reason"),
    readStringProp(value, "description"),
    readStringProp(value, "summary"),
  );

export const readClaudeFailedTaskReason = (
  value: ClaudeAgentResult | ClaudeFailureDetails,
): string | undefined =>
  firstClaudeTaskText(
    readStringProp(value, "error"),
    readStringProp(value, "message"),
    readStringProp(value, "reason"),
  );

export const readClaudeTaskStopTaskId = (
  resultRaw: ClaudeDecodedToolResult["raw"],
  resultText: string,
): string | undefined => {
  const structuredTaskId = readStringProp(readStructuredClaudeAgentResult(resultRaw), "task_id");
  if (structuredTaskId) {
    return structuredTaskId;
  }
  try {
    const parsed = jsonObjectSchema.safeParse(JSON.parse(resultText));
    return parsed.success ? readStringProp(parsed.data, "task_id") : undefined;
  } catch {
    return undefined;
  }
};

export const resolveClaudeSubagentToolUseId = (
  taskIdsByToolUseId: ReadonlyMap<string, string>,
  agentIdsByToolUseId: ReadonlyMap<string, string> | undefined,
  taskId: string,
  toolUseId: string | undefined,
): string | undefined => {
  if (toolUseId) {
    return toolUseId;
  }
  for (const [candidateToolUseId, candidateTaskId] of taskIdsByToolUseId) {
    if (candidateTaskId === taskId) {
      return candidateToolUseId;
    }
  }
  for (const [candidateToolUseId, candidateAgentId] of agentIdsByToolUseId ?? []) {
    if (candidateAgentId === taskId) {
      return candidateToolUseId;
    }
  }
  return undefined;
};
