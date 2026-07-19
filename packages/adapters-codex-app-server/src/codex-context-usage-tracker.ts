import { extractThreadIdFromParams } from "./codex-app-server-requests";
import { isPlainObject } from "./codex-app-server-shared";
import { extractCodexTokenUsageTotals } from "./codex-app-server-transcript";
import type { CodexNotificationRecord, CodexSessionContextUsage } from "./types";

const contextUsageKey = (runtimeId: string, threadId: string): string =>
  JSON.stringify([runtimeId, threadId]);

const parseContextUsageKey = (key: string): [string, string] => JSON.parse(key) as [string, string];

const canonicalZeroUsage = (params: unknown): CodexSessionContextUsage | null => {
  if (!isPlainObject(params) || !isPlainObject(params.tokenUsage)) {
    return null;
  }
  const usage = params.tokenUsage;
  if (!isPlainObject(usage.last) || !isPlainObject(usage.total)) {
    return null;
  }
  if (usage.last.totalTokens !== 0 || usage.total.totalTokens !== 0) {
    return null;
  }
  const contextWindow = usage.modelContextWindow;
  if (contextWindow !== null && (typeof contextWindow !== "number" || contextWindow <= 0)) {
    return null;
  }
  return {
    totalTokens: 0,
    ...(typeof contextWindow === "number" ? { contextWindow } : {}),
  };
};

export class CodexContextUsageTracker {
  private readonly latestByKey = new Map<string, CodexSessionContextUsage>();

  latest(runtimeId: string, threadId: string): CodexSessionContextUsage | null {
    return this.latestByKey.get(contextUsageKey(runtimeId, threadId)) ?? null;
  }

  async load(
    runtimeId: string,
    threadId: string,
    resumeWithTurns: () => Promise<void>,
  ): Promise<CodexSessionContextUsage | null> {
    const retained = this.latest(runtimeId, threadId);
    if (retained) {
      return retained;
    }
    try {
      await resumeWithTurns();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Codex context usage for runtime '${runtimeId}' session '${threadId}': ${message}`,
        { cause: error },
      );
    }
    return this.latest(runtimeId, threadId);
  }

  observeNotification(runtimeId: string, notification: CodexNotificationRecord): void {
    if (notification.method !== "thread/tokenUsage/updated") {
      return;
    }
    const threadId = extractThreadIdFromParams(notification.params);
    if (!threadId) {
      throw new Error("Codex context usage notification is missing threadId.");
    }
    const usage =
      extractCodexTokenUsageTotals(notification.params) ?? canonicalZeroUsage(notification.params);
    if (!usage) {
      throw new Error(
        `Codex context usage notification for thread '${threadId}' has invalid token usage.`,
      );
    }
    this.latestByKey.set(contextUsageKey(runtimeId, threadId), usage);
  }

  clearRuntime(runtimeId: string): void {
    for (const [key] of this.latestByKey) {
      if (parseContextUsageKey(key)[0] === runtimeId) {
        this.latestByKey.delete(key);
      }
    }
  }

  clearSession(threadId: string, runtimeId?: string): void {
    for (const [key] of this.latestByKey) {
      const [retainedRuntimeId, retainedThreadId] = parseContextUsageKey(key);
      if (retainedThreadId === threadId && (!runtimeId || retainedRuntimeId === runtimeId)) {
        this.latestByKey.delete(key);
      }
    }
  }
}
