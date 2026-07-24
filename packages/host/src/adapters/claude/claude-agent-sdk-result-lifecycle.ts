export type ClaudeResultLike = {
  duration_ms?: unknown;
  is_error?: unknown;
  stop_reason?: unknown;
  subtype?: unknown;
  terminal_reason?: unknown;
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

export const readClaudeResultDurationMs = (message: ClaudeResultLike): number | undefined => {
  const durationMs = message.duration_ms;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : undefined;
};

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

export const lifecycleOutcomeForClaudeResult = (
  message: ClaudeResultLike,
): ClaudeResultLifecycleOutcome => {
  if (isFailedClaudeResult(message)) {
    return "failed";
  }
  const terminalReason = readClaudeResultTerminalReason(message);
  if (terminalReason === "tool_deferred" || terminalReason === "background_requested") {
    return "awaiting_sdk_idle";
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
