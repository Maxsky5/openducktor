export type ClaudeResultLike = {
  duration_ms?: unknown;
  is_error?: unknown;
  stop_reason?: unknown;
  subtype?: unknown;
  terminal_reason?: unknown;
};

export type ClaudeAssistantLike = {
  message?: {
    stop_reason?: unknown;
  };
};

export type ClaudeResultLifecycleOutcome =
  | "completed"
  | "failed"
  | "continuing"
  | "awaiting_sdk_idle";

export const readClaudeResultTerminalReason = (message: ClaudeResultLike): string | undefined =>
  typeof message.terminal_reason === "string" ? message.terminal_reason : undefined;

export const readClaudeResultStopReason = (message: ClaudeResultLike): string | undefined =>
  typeof message.stop_reason === "string" ? message.stop_reason : undefined;

export const readClaudeResultDurationMs = (message: ClaudeResultLike): number | undefined => {
  const durationMs = message.duration_ms;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : undefined;
};

export const readClaudeAssistantStopReason = (message: ClaudeAssistantLike): string | undefined =>
  typeof message.message?.stop_reason === "string" ? message.message.stop_reason : undefined;

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
  const stopReason = readClaudeResultStopReason(message);
  if (terminalReason === "tool_deferred" || terminalReason === "background_requested") {
    return "awaiting_sdk_idle";
  }
  if (
    terminalReason === "completed" ||
    stopReason === "end_turn" ||
    stopReason === "stop_sequence"
  ) {
    return "completed";
  }
  return "continuing";
};

export const lifecycleOutcomeForClaudeAssistantMessage = (
  message: ClaudeAssistantLike,
): Extract<ClaudeResultLifecycleOutcome, "completed" | "continuing"> => {
  const stopReason = readClaudeAssistantStopReason(message);
  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    return "completed";
  }
  return "continuing";
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
  return readClaudeResultTerminalReason(message) === "completed" ? "stop" : null;
};
