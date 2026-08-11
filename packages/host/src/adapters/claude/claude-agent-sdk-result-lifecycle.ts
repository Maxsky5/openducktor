export type ClaudeResultLike = {
  duration_ms?: unknown;
  errors?: unknown;
  is_error?: unknown;
  result?: unknown;
  stop_reason?: unknown;
  subtype?: unknown;
  terminal_reason?: unknown;
};

export const failedClaudeResultText = (message: ClaudeResultLike): string => {
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((error): error is string => typeof error === "string")
    : [];
  if (errors.length > 0) {
    return errors.join("\n");
  }
  const result = typeof message.result === "string" ? message.result.trim() : "";
  if (result.length > 0) {
    return result;
  }
  const terminalReason =
    typeof message.terminal_reason === "string" ? message.terminal_reason : undefined;
  return `Claude Agent SDK result failed: ${terminalReason ?? String(message.subtype)}`;
};

export type ClaudeResultLifecycleOutcome =
  | "completed"
  | "failed"
  | "continuing"
  | "awaiting_sdk_idle";

const readClaudeResultTerminalReason = (message: ClaudeResultLike): string | undefined =>
  typeof message.terminal_reason === "string" ? message.terminal_reason : undefined;

const readClaudeResultStopReason = (message: ClaudeResultLike): string | undefined =>
  typeof message.stop_reason === "string" ? message.stop_reason : undefined;

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
  const text = typeof message.result === "string" ? message.result.trim() : "";
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
