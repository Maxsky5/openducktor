import { extractCodexTokenUsageTotals } from "./codex-app-server-transcript";
import type { CodexNotificationRecord, CodexSessionContextUsage } from "./types";
import { z } from "zod";

const contextUsageKey = (runtimeId: string, threadId: string): string =>
  JSON.stringify([runtimeId, threadId]);

const contextUsageKeySchema = z.tuple([z.string(), z.string()]);
const parseContextUsageKey = (key: string): [string, string] =>
  contextUsageKeySchema.parse(JSON.parse(key));

export class CodexContextUsageTracker {
  private readonly latestByKey = new Map<string, CodexSessionContextUsage>();
  private readonly inFlightLoadsByKey = new Map<string, Promise<CodexSessionContextUsage | null>>();

  initializeFreshThread(runtimeId: string, threadId: string): void {
    const key = contextUsageKey(runtimeId, threadId);
    if (!this.latestByKey.has(key)) {
      this.latestByKey.set(key, { totalTokens: 0 });
    }
  }

  latest(runtimeId: string, threadId: string): CodexSessionContextUsage | null {
    return this.latestByKey.get(contextUsageKey(runtimeId, threadId)) ?? null;
  }

  async load(
    runtimeId: string,
    threadId: string,
    resumeWithTurns: () => Promise<void>,
  ): Promise<CodexSessionContextUsage | null> {
    const key = contextUsageKey(runtimeId, threadId);
    const inFlight = this.inFlightLoadsByKey.get(key);
    if (inFlight) {
      return inFlight;
    }
    const load = Promise.resolve().then(async () => {
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
    });
    this.inFlightLoadsByKey.set(key, load);
    try {
      return await load;
    } finally {
      if (this.inFlightLoadsByKey.get(key) === load) {
        this.inFlightLoadsByKey.delete(key);
      }
    }
  }

  observeNotification(runtimeId: string, notification: CodexNotificationRecord): void {
    if (notification.method !== "thread/tokenUsage/updated") {
      return;
    }
    const { threadId } = notification.params;
    const usage = extractCodexTokenUsageTotals(notification.params);
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
