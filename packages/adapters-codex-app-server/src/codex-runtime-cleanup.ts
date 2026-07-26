type CodexRuntimeCleanupPlan = {
  cancelContextUsage(): void;
  releaseSessions(): void;
  clearPendingInput(): void;
  clearSubagents(): void;
  clearRuntimeEvents(): void;
  disposeThreadInventory(): void;
};

export const releaseCodexRuntimeState = (
  runtimeId: string,
  plan: CodexRuntimeCleanupPlan,
): void => {
  const failures: Array<{ label: string; cause: unknown }> = [];
  const cleanup = (label: string, operation: () => void): void => {
    try {
      operation();
    } catch (cause) {
      failures.push({ label, cause });
    }
  };

  cleanup("context usage", plan.cancelContextUsage);
  cleanup("sessions", plan.releaseSessions);
  cleanup("pending input", plan.clearPendingInput);
  cleanup("subagents", plan.clearSubagents);
  cleanup("runtime events", plan.clearRuntimeEvents);
  cleanup("thread inventory", plan.disposeThreadInventory);

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
