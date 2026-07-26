type CodexRuntimeCleanupDeps = {
  cancelContextUsage(runtimeId: string): void;
  releaseSessions(runtimeId: string): void;
  clearPendingInput(runtimeId: string): void;
  clearSubagents(runtimeId: string): void;
  clearRuntimeEvents(runtimeId: string): void;
  disposeThreadInventory(runtimeId: string): void;
};

export const releaseCodexRuntimeState = (
  runtimeId: string,
  deps: CodexRuntimeCleanupDeps,
): void => {
  const failures: Array<{ label: string; cause: unknown }> = [];
  const cleanup = (label: string, operation: () => void): void => {
    try {
      operation();
    } catch (cause) {
      failures.push({ label, cause });
    }
  };

  cleanup("context usage", () => deps.cancelContextUsage(runtimeId));
  cleanup("sessions", () => deps.releaseSessions(runtimeId));
  cleanup("pending input", () => deps.clearPendingInput(runtimeId));
  cleanup("subagents", () => deps.clearSubagents(runtimeId));
  cleanup("runtime events", () => deps.clearRuntimeEvents(runtimeId));
  cleanup("thread inventory", () => deps.disposeThreadInventory(runtimeId));

  if (failures.length === 0) {
    return;
  }

  const details = failures
    .map(({ label, cause }) => `${label}: ${cause instanceof Error ? cause.message : cause}`)
    .join("\n");
  throw new AggregateError(
    failures.map(({ cause }) => cause),
    `Failed to release Codex runtime '${runtimeId}':\n${details}`,
  );
};
