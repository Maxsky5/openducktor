import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import {
  type CodexThreadInventory,
  type CodexThreadSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import type { CodexNotificationRecord } from "./types";

type HistoryOnlyIdleThreadLoad = {
  repoPath: string;
  workingDirectory: string;
};

const IDLE_CODEX_THREAD_STATUS = codexThreadStatusSnapshot("idle");

export class CodexHistoryPresenceOverlay {
  private readonly idleHistoryLoadsByThreadId = new Map<string, HistoryOnlyIdleThreadLoad>();

  rememberIdleHistoryLoad(input: LoadAgentSessionHistoryInput, thread: CodexThreadSnapshot): void {
    if (thread.status.agentSessionStatus !== "idle") {
      this.clear(thread.id);
      return;
    }
    this.idleHistoryLoadsByThreadId.set(thread.id, {
      repoPath: input.repoPath,
      workingDirectory: input.workingDirectory,
    });
  }

  clear(threadId: string): void {
    this.idleHistoryLoadsByThreadId.delete(threadId);
  }

  clearMissingLoadedThreads(inventory: CodexThreadInventory): void {
    for (const threadId of this.idleHistoryLoadsByThreadId.keys()) {
      if (!inventory.loadedIds.has(threadId)) {
        this.clear(threadId);
      }
    }
  }

  clearForNotification(threadId: string, notification: CodexNotificationRecord): void {
    if (!this.idleHistoryLoadsByThreadId.has(threadId)) {
      return;
    }
    if (notification.method === "turn/started") {
      this.clear(threadId);
      return;
    }
    if (notification.method !== "thread/status/changed" || !isPlainObject(notification.params)) {
      return;
    }
    if (codexThreadStatusSnapshot(notification.params.status).classification !== "idle") {
      this.clear(threadId);
    }
  }

  apply(thread: CodexThreadSnapshot, repoPath: string): CodexThreadSnapshot {
    const historyOnlyLoad = this.idleHistoryLoadsByThreadId.get(thread.id);
    if (
      !historyOnlyLoad ||
      historyOnlyLoad.repoPath !== repoPath ||
      historyOnlyLoad.workingDirectory !== thread.cwd
    ) {
      return thread;
    }
    if (thread.status.classification !== "running") {
      if (thread.status.classification !== "idle") {
        this.clear(thread.id);
      }
      return thread;
    }
    return {
      ...thread,
      status: {
        classification: IDLE_CODEX_THREAD_STATUS.classification,
        status: { ...IDLE_CODEX_THREAD_STATUS.status },
        agentSessionStatus: IDLE_CODEX_THREAD_STATUS.agentSessionStatus,
      },
    };
  }
}
