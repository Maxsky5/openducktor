import {
  arrayFromUnknown,
  extractStringField,
  isCodexThreadNotLoadedError,
  isCodexUnmaterializedThreadError,
  isPlainObject,
} from "./codex-app-server-shared";
import {
  type CodexThreadInventory,
  type CodexThreadSnapshot,
  codexLoadedThreadIds,
  codexThreadList,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import type { CodexAppServerClient, CodexNotificationRecord } from "./types";

type ReadOnlyIdleHistoryLoad = {
  workingDirectory: string;
  status: CodexThreadSnapshot["status"];
};

export class CodexThreadInventoryReader {
  private readonly inventoryByRuntimeId = new Map<string, CodexThreadInventory>();
  private readonly pendingInventoryByRuntimeId = new Map<string, Promise<CodexThreadInventory>>();
  private readonly readOnlyIdleHistoryLoadsByThreadId = new Map<string, ReadOnlyIdleHistoryLoad>();

  clear(runtimeId: string): void {
    this.inventoryByRuntimeId.delete(runtimeId);
    this.pendingInventoryByRuntimeId.delete(runtimeId);
  }

  clearReadOnlyHistoryLoad(threadId: string): void {
    this.readOnlyIdleHistoryLoadsByThreadId.delete(threadId);
  }

  clearReadOnlyHistoryLoadForNotification(
    threadId: string,
    notification: CodexNotificationRecord,
  ): void {
    if (!this.hasReadOnlyHistoryLoad(threadId)) {
      return;
    }
    if (notification.method === "turn/started") {
      this.clearReadOnlyHistoryLoad(threadId);
      return;
    }
    if (notification.method !== "thread/status/changed" || !isPlainObject(notification.params)) {
      return;
    }
    if (codexThreadStatusSnapshot(notification.params.status).classification !== "idle") {
      this.clearReadOnlyHistoryLoad(threadId);
    }
  }

  async read(client: CodexAppServerClient, runtimeId: string): Promise<CodexThreadInventory> {
    const existing = this.inventoryByRuntimeId.get(runtimeId);
    if (existing) {
      return existing;
    }
    const pending = this.pendingInventoryByRuntimeId.get(runtimeId);
    if (pending) {
      return pending;
    }
    const nextPending = this.fetch(client, runtimeId).then(
      (inventory) => {
        if (this.pendingInventoryByRuntimeId.get(runtimeId) === nextPending) {
          this.inventoryByRuntimeId.set(runtimeId, inventory);
          this.pendingInventoryByRuntimeId.delete(runtimeId);
        }
        return inventory;
      },
      (error) => {
        if (this.pendingInventoryByRuntimeId.get(runtimeId) === nextPending) {
          this.pendingInventoryByRuntimeId.delete(runtimeId);
        }
        throw error;
      },
    );
    this.pendingInventoryByRuntimeId.set(runtimeId, nextPending);
    return nextPending;
  }

  async refresh(client: CodexAppServerClient, runtimeId: string): Promise<CodexThreadInventory> {
    this.clear(runtimeId);
    return this.read(client, runtimeId);
  }

  async findThread(
    client: CodexAppServerClient,
    runtimeId: string,
    externalSessionId: string,
  ): Promise<CodexThreadSnapshot | null> {
    return (await this.read(client, runtimeId)).threadsById.get(externalSessionId) ?? null;
  }

  async ensureThreadReadable(
    client: CodexAppServerClient,
    runtimeId: string,
    input: { externalSessionId: string; workingDirectory: string },
  ): Promise<boolean> {
    const thread = await this.findThread(client, runtimeId, input.externalSessionId);
    if (!thread || thread.cwd !== input.workingDirectory) {
      return false;
    }
    if (thread.status.status.type === "idle") {
      try {
        await client.threadRead({
          threadId: input.externalSessionId,
          includeTurns: false,
        });
        return true;
      } catch (error) {
        if (!isCodexThreadNotLoadedError(error)) {
          throw error;
        }
        return false;
      }
    }
    await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
    });
    this.clear(runtimeId);
    await client.threadRead({
      threadId: input.externalSessionId,
      includeTurns: false,
    });
    return true;
  }

  async loadThreadForHistory(
    client: CodexAppServerClient,
    runtimeId: string,
    input: { externalSessionId: string; workingDirectory: string },
  ): Promise<CodexThreadSnapshot | null> {
    const inventory = await this.read(client, runtimeId);
    const thread = inventory.threadsById.get(input.externalSessionId) ?? null;
    if (!thread || thread.cwd !== input.workingDirectory) {
      return null;
    }
    await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
    });
    this.rememberReadOnlyIdleHistoryLoad(thread);
    this.clear(runtimeId);
    return thread;
  }

  async readThreadWithTurns(client: CodexAppServerClient, threadId: string): Promise<unknown> {
    let response: unknown;
    try {
      response = await client.threadRead({ threadId, includeTurns: true });
    } catch (error) {
      if (isCodexUnmaterializedThreadError(error)) {
        return { thread: { id: threadId, turns: [] } };
      }
      throw error;
    }
    const pagedTurns = await this.fetchThreadTurns(client, threadId);
    if (pagedTurns.length === 0) {
      return response;
    }
    if (!isPlainObject(response) || !isPlainObject(response.thread)) {
      return { thread: { id: threadId, turns: pagedTurns } };
    }
    return { ...response, thread: { ...response.thread, turns: pagedTurns } };
  }

  private async fetch(
    client: CodexAppServerClient,
    runtimeId: string,
  ): Promise<CodexThreadInventory> {
    const [loadedIds, threads] = await Promise.all([
      this.fetchLoadedThreadIds(client),
      this.fetchThreads(client),
    ]);
    return this.withReadOnlyHistoryStatuses({
      runtimeId,
      loadedIds,
      threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    });
  }

  private hasReadOnlyHistoryLoad(threadId: string): boolean {
    return this.readOnlyIdleHistoryLoadsByThreadId.has(threadId);
  }

  private rememberReadOnlyIdleHistoryLoad(thread: CodexThreadSnapshot): void {
    if (thread.status.agentSessionStatus !== "idle") {
      this.clearReadOnlyHistoryLoad(thread.id);
      return;
    }
    this.readOnlyIdleHistoryLoadsByThreadId.set(thread.id, {
      workingDirectory: thread.cwd,
      status: thread.status,
    });
  }

  private withReadOnlyHistoryStatuses(inventory: CodexThreadInventory): CodexThreadInventory {
    if (this.readOnlyIdleHistoryLoadsByThreadId.size === 0) {
      return inventory;
    }

    const threadsById = new Map(inventory.threadsById);
    for (const [threadId, readOnlyLoad] of this.readOnlyIdleHistoryLoadsByThreadId) {
      const thread = threadsById.get(threadId);
      if (!thread) {
        this.clearReadOnlyHistoryLoad(threadId);
        continue;
      }
      if (thread.cwd !== readOnlyLoad.workingDirectory || !inventory.loadedIds.has(threadId)) {
        this.clearReadOnlyHistoryLoad(threadId);
        continue;
      }
      if (thread.status.classification !== "running") {
        if (thread.status.classification !== "idle") {
          this.clearReadOnlyHistoryLoad(threadId);
        }
        continue;
      }
      threadsById.set(threadId, {
        ...thread,
        status: readOnlyLoad.status,
      });
    }

    return { ...inventory, threadsById };
  }

  private async fetchLoadedThreadIds(client: CodexAppServerClient): Promise<Set<string>> {
    const loadedIds = new Set<string>();
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadLoadedList({ cursor, limit: 100 });
      const pageIds = codexLoadedThreadIds(response);
      for (const threadId of pageIds) {
        loadedIds.add(threadId);
      }
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/loaded/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return loadedIds;
  }

  private async fetchThreads(client: CodexAppServerClient): Promise<CodexThreadSnapshot[]> {
    const threads: CodexThreadSnapshot[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadList({ cursor, limit: 100 });
      threads.push(...codexThreadList(response));
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return threads;
  }

  private async fetchThreadTurns(
    client: CodexAppServerClient,
    threadId: string,
  ): Promise<Record<string, unknown>[]> {
    const turns: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await client.threadTurnsList({
        threadId,
        cursor,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
      });
      turns.push(...arrayFromUnknown(response).filter(isPlainObject));
      cursor = isPlainObject(response)
        ? (extractStringField(response, ["nextCursor", "next_cursor"]) ?? null)
        : null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex thread/turns/list returned a repeated pagination cursor.");
      }
    } while (cursor);
    return turns;
  }
}
