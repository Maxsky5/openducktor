import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ClaudeHistoryResultMessage } from "./claude-agent-sdk-history-import";

export type ClaudeResultLike = SDKResultMessage | ClaudeHistoryResultMessage;

const claudeResultErrorsSchema = z.array(z.unknown()).transform((errors) =>
  errors.flatMap((error) => {
    const parsedError = z.string().safeParse(error);
    return parsedError.success ? [parsedError.data] : [];
  }),
);
const claudeResultStringSchema = z.string();

const readClaudeResultErrors = (message: ClaudeResultLike): string[] => {
  const errors = "errors" in message ? message.errors : undefined;
  const parsedErrors = claudeResultErrorsSchema.safeParse(errors);
  return parsedErrors.success ? parsedErrors.data : [];
};

const readClaudeResultText = (message: ClaudeResultLike): string => {
  const result = "result" in message ? message.result : undefined;
  const parsedResult = claudeResultStringSchema.safeParse(result);
  return parsedResult.success ? parsedResult.data.trim() : "";
};

export const failedClaudeResultText = (message: ClaudeResultLike): string => {
  const errors = readClaudeResultErrors(message);
  if (errors.length > 0) {
    return errors.join("\n");
  }
  const result = readClaudeResultText(message);
  if (result.length > 0) {
    return result;
  }
  return `Claude Agent SDK result failed: ${readClaudeResultTerminalReason(message) ?? String(message.subtype)}`;
};

export type ClaudeResultLifecycleOutcome =
  | "completed"
  | "failed"
  | "continuing"
  | "awaiting_sdk_idle";

const readClaudeResultTerminalReason = (message: ClaudeResultLike): string | undefined => {
  const terminalReason = "terminal_reason" in message ? message.terminal_reason : undefined;
  const parsedTerminalReason = claudeResultStringSchema.safeParse(terminalReason);
  return parsedTerminalReason.success ? parsedTerminalReason.data : undefined;
};

const readClaudeResultStopReason = (message: ClaudeResultLike): string | undefined =>
  message.stop_reason ?? undefined;

export const isFailedClaudeResult = (message: ClaudeResultLike): boolean => {
  if (message.subtype !== "success" || message.is_error === true) {
    return true;
  }
  const terminalReason = readClaudeResultTerminalReason(message);
  return Boolean(
    terminalReason &&
    terminalReason !== "completed" &&
    terminalReason !== "tool_deferred" &&
    terminalReason !== "background_requested",
  );
};

export const successfulClaudeResultText = (message: ClaudeResultLike): string | null => {
  if (isFailedClaudeResult(message)) {
    return null;
  }
  const text = readClaudeResultText(message);
  return text.length > 0 ? text : null;
};

export const lifecycleOutcomeForClaudeResult = (
  message: ClaudeResultLike,
): ClaudeResultLifecycleOutcome => {
  if (isFailedClaudeResult(message)) {
    return "failed";
  }
  const terminalReason = readClaudeResultTerminalReason(message);
  if (terminalReason === "tool_deferred") {
    return "awaiting_sdk_idle";
  }
  if (terminalReason === "background_requested") {
    return "completed";
  }
  if (readClaudeResultStopReason(message) === "tool_use") {
    return "continuing";
  }
  return "completed";
};

export const finishReasonForClaudeStopReason = (
  stopReason: string | null | undefined,
): string | null => {
  if (!stopReason || stopReason === "tool_use") {
    return null;
  }
  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    return "stop";
  }
  return stopReason;
};

export const finishReasonForClaudeResult = (message: ClaudeResultLike): string | null => {
  const stopReason = readClaudeResultStopReason(message);
  const stopFinishReason = finishReasonForClaudeStopReason(stopReason);
  if (stopFinishReason) {
    return stopFinishReason;
  }
  return lifecycleOutcomeForClaudeResult(message) === "completed" ? "stop" : null;
};
