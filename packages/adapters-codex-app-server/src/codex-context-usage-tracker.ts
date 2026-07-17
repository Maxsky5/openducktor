import { extractThreadIdFromParams } from "./codex-app-server-requests";
import { isPlainObject } from "./codex-app-server-shared";
import { extractCodexTokenUsageTotals } from "./codex-app-server-transcript";
import type { CodexRuntimeStreamEvent } from "./codex-runtime-events";
import type { CodexNotificationRecord, CodexSessionContextUsage } from "./types";

export type CodexContextUsageReplayScheduler = {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, timeoutMs: number): unknown;
};

export type CodexContextUsageObservation = {
  key: string;
  generation: number;
};

type RetainedContextUsage = {
  usage: CodexSessionContextUsage;
  observationGeneration: number;
};

type ContextUsageRecovery = {
  runtimeId: string;
  threadId: string;
  released: Promise<never>;
  rejectReleased(error: Error): void;
  replayObserved: Promise<void>;
  resolveReplayObserved(): void;
  observationGenerationAtStart: number;
  resumeCompletedObservationGeneration: number | null;
  promise?: Promise<CodexSessionContextUsage>;
};

const contextUsageKey = (runtimeId: string, threadId: string): string =>
  JSON.stringify([runtimeId, threadId]);

const parseContextUsageKey = (key: string): [string, string] => JSON.parse(key) as [string, string];

export const CODEX_CONTEXT_USAGE_REPLAY_TIMEOUT_MS = 10_000;

const defaultContextUsageReplayScheduler: CodexContextUsageReplayScheduler = {
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
};

export class CodexContextUsageTracker {
  private readonly latestByKey = new Map<string, RetainedContextUsage>();
  private readonly observationGenerationByKey = new Map<string, number>();
  private readonly recoveriesByKey = new Map<string, ContextUsageRecovery>();

  constructor(
    private readonly waitForRuntimeEventBarrier: (runtimeId: string) => Promise<void>,
    private readonly replayScheduler: CodexContextUsageReplayScheduler = defaultContextUsageReplayScheduler,
  ) {}

  latest(runtimeId: string, threadId: string): CodexSessionContextUsage | null {
    return this.latestByKey.get(contextUsageKey(runtimeId, threadId))?.usage ?? null;
  }

  load(
    runtimeId: string,
    threadId: string,
    resumeWithTurns: () => Promise<void>,
  ): Promise<CodexSessionContextUsage> {
    const retained = this.latest(runtimeId, threadId);
    if (retained) {
      return Promise.resolve(retained);
    }

    const key = contextUsageKey(runtimeId, threadId);
    const existing = this.recoveriesByKey.get(key);
    if (existing) {
      if (!existing.promise) {
        throw new Error(
          `Codex context usage recovery for runtime '${runtimeId}' session '${threadId}' was not initialized.`,
        );
      }
      return existing.promise;
    }

    let rejectReleased: ((error: Error) => void) | undefined;
    const released = new Promise<never>((_resolve, reject) => {
      rejectReleased = reject;
    });
    let resolveReplayObserved!: () => void;
    const replayObserved = new Promise<void>((resolve) => {
      resolveReplayObserved = resolve;
    });
    const recovery: ContextUsageRecovery = {
      runtimeId,
      threadId,
      released,
      rejectReleased: (error) => rejectReleased?.(error),
      replayObserved,
      resolveReplayObserved,
      observationGenerationAtStart: this.observationGenerationByKey.get(key) ?? 0,
      resumeCompletedObservationGeneration: null,
    };
    this.recoveriesByKey.set(key, recovery);
    const promise = this.performRecovery(recovery, resumeWithTurns);
    recovery.promise = promise;
    return promise;
  }

  reserveObservation(
    event: Pick<CodexRuntimeStreamEvent, "runtimeId" | "kind" | "message">,
  ): CodexContextUsageObservation | null {
    if (
      event.kind !== "notification" ||
      !isPlainObject(event.message) ||
      event.message.method !== "thread/tokenUsage/updated"
    ) {
      return null;
    }
    const threadId = extractThreadIdFromParams(event.message.params);
    if (!threadId) {
      return null;
    }
    return this.nextObservation(contextUsageKey(event.runtimeId, threadId));
  }

  observeNotification(
    runtimeId: string,
    notification: CodexNotificationRecord,
    reservedObservation?: CodexContextUsageObservation | null,
  ): void {
    if (notification.method !== "thread/tokenUsage/updated") {
      return;
    }
    const threadId = extractThreadIdFromParams(notification.params);
    const usage = extractCodexTokenUsageTotals(notification.params);
    if (!threadId || !usage) {
      return;
    }
    const key = contextUsageKey(runtimeId, threadId);
    const observation =
      reservedObservation?.key === key ? reservedObservation : this.nextObservation(key);
    const retained = this.latestByKey.get(key);
    const recovery = this.recoveriesByKey.get(key);
    const isPostResponseReplay =
      recovery?.resumeCompletedObservationGeneration !== null &&
      recovery?.resumeCompletedObservationGeneration !== undefined &&
      observation.generation > recovery.resumeCompletedObservationGeneration;
    const alreadyObservedSinceRecoveryStarted = recovery
      ? (retained?.observationGeneration ?? 0) > recovery.observationGenerationAtStart
      : false;
    if (isPostResponseReplay) {
      recovery.resolveReplayObserved();
    }
    if (
      (retained && retained.observationGeneration > observation.generation) ||
      (isPostResponseReplay && alreadyObservedSinceRecoveryStarted)
    ) {
      return;
    }
    this.latestByKey.set(key, {
      usage,
      observationGeneration: observation.generation,
    });
  }

  releaseRuntime(runtimeId: string, error: Error): void {
    for (const [key] of this.latestByKey) {
      if (parseContextUsageKey(key)[0] === runtimeId) {
        this.latestByKey.delete(key);
      }
    }
    for (const key of this.observationGenerationByKey.keys()) {
      if (parseContextUsageKey(key)[0] === runtimeId) {
        this.observationGenerationByKey.delete(key);
      }
    }
    for (const recovery of this.recoveriesByKey.values()) {
      if (recovery.runtimeId === runtimeId) {
        recovery.rejectReleased(error);
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
    for (const key of this.observationGenerationByKey.keys()) {
      const [retainedRuntimeId, retainedThreadId] = parseContextUsageKey(key);
      if (retainedThreadId === threadId && (!runtimeId || retainedRuntimeId === runtimeId)) {
        this.observationGenerationByKey.delete(key);
      }
    }
    for (const recovery of this.recoveriesByKey.values()) {
      if (recovery.threadId === threadId && (!runtimeId || recovery.runtimeId === runtimeId)) {
        recovery.rejectReleased(
          new Error(`Codex session '${threadId}' was released while context usage was loading.`),
        );
      }
    }
  }

  private async performRecovery(
    recovery: ContextUsageRecovery,
    resumeWithTurns: () => Promise<void>,
  ): Promise<CodexSessionContextUsage> {
    const key = contextUsageKey(recovery.runtimeId, recovery.threadId);
    try {
      await Promise.resolve();
      await Promise.race([resumeWithTurns(), recovery.released]);
      recovery.resumeCompletedObservationGeneration =
        this.observationGenerationByKey.get(key) ?? recovery.observationGenerationAtStart;
      await this.waitForReplay(recovery);
      await Promise.race([this.waitForRuntimeEventBarrier(recovery.runtimeId), recovery.released]);
      const retained = this.latest(recovery.runtimeId, recovery.threadId);
      if (!retained) {
        throw new Error("Codex context usage was observed without retained context state.");
      }
      return retained;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Codex context usage for runtime '${recovery.runtimeId}' session '${recovery.threadId}': ${message}`,
        { cause: error },
      );
    } finally {
      if (this.recoveriesByKey.get(key) === recovery) {
        this.recoveriesByKey.delete(key);
      }
    }
  }

  private async waitForReplay(recovery: ContextUsageRecovery): Promise<void> {
    let timeoutHandle: unknown | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeoutHandle = this.replayScheduler.setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for Codex context usage replay for runtime '${recovery.runtimeId}' session '${recovery.threadId}' after ${CODEX_CONTEXT_USAGE_REPLAY_TIMEOUT_MS}ms: thread/resume completed but no matching thread/tokenUsage/updated notification arrived.`,
          ),
        );
      }, CODEX_CONTEXT_USAGE_REPLAY_TIMEOUT_MS);
    });

    try {
      await Promise.race([recovery.replayObserved, recovery.released, timedOut]);
    } finally {
      if (timeoutHandle !== null) {
        this.replayScheduler.clearTimeout(timeoutHandle);
      }
    }
  }

  private nextObservation(key: string): CodexContextUsageObservation {
    const generation = (this.observationGenerationByKey.get(key) ?? 0) + 1;
    this.observationGenerationByKey.set(key, generation);
    return { key, generation };
  }
}
