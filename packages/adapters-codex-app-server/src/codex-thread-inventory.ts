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
  type CodexThreadStatusSnapshot,
  codexLoadedThreadIds,
  codexThreadList,
  threadSnapshotFromReadResponse,
} from "./codex-app-server-threads";
import type { CodexAppServerClient } from "./types";

type PendingInventoryRead = {
  mode: "read" | "refresh";
  promise: Promise<CodexThreadInventory>;
};

export class CodexThreadInventoryReader {
  private readonly inventoryByRuntimeId = new Map<string, CodexThreadInventory>();
  private readonly pendingInventoryByRuntimeId = new Map<string, PendingInventoryRead>();
  private readonly statusOverridesByRuntimeId = new Map<
    string,
    Map<string, CodexThreadStatusSnapshot>
  >();

  clearInventory(runtimeId: string): void {
    this.inventoryByRuntimeId.delete(runtimeId);
    this.pendingInventoryByRuntimeId.delete(runtimeId);
  }

  async read(client: CodexAppServerClient, runtimeId: string): Promise<CodexThreadInventory> {
    const existing = this.inventoryByRuntimeId.get(runtimeId);
    if (existing) {
      return this.withStatusOverrides(runtimeId, existing);
    }
    const pending = this.pendingInventoryByRuntimeId.get(runtimeId);
    if (pending) {
      return pending.promise;
    }
    return this.startInventoryRead(client, runtimeId, "read");
  }

  async refresh(client: CodexAppServerClient, runtimeId: string): Promise<CodexThreadInventory> {
    this.inventoryByRuntimeId.delete(runtimeId);
    const pending = this.pendingInventoryByRuntimeId.get(runtimeId);
    if (pending?.mode === "refresh") {
      return pending.promise;
    }
    return this.startInventoryRead(client, runtimeId, "refresh");
  }

  private startInventoryRead(
    client: CodexAppServerClient,
    runtimeId: string,
    mode: PendingInventoryRead["mode"],
  ): Promise<CodexThreadInventory> {
    const nextPending: PendingInventoryRead = {
      mode,
      promise: this.fetch(client, runtimeId).then(
        (inventory) => {
          if (this.pendingInventoryByRuntimeId.get(runtimeId) === nextPending) {
            this.inventoryByRuntimeId.set(runtimeId, inventory);
            this.pendingInventoryByRuntimeId.delete(runtimeId);
          }
          return this.withStatusOverrides(runtimeId, inventory);
        },
        (error) => {
          if (this.pendingInventoryByRuntimeId.get(runtimeId) === nextPending) {
            this.pendingInventoryByRuntimeId.delete(runtimeId);
          }
          throw error;
        },
      ),
    };
    this.pendingInventoryByRuntimeId.set(runtimeId, nextPending);
    return nextPending.promise;
  }

  updateThreadStatus(runtimeId: string, threadId: string, status: CodexThreadStatusSnapshot): void {
    const statusOverrides =
      this.statusOverridesByRuntimeId.get(runtimeId) ??
      new Map<string, CodexThreadStatusSnapshot>();
    statusOverrides.set(threadId, status);
    this.statusOverridesByRuntimeId.set(runtimeId, statusOverrides);
  }

  clearThreadStatus(runtimeId: string, threadId: string): void {
    const statusOverrides = this.statusOverridesByRuntimeId.get(runtimeId);
    if (!statusOverrides) {
      return;
    }
    statusOverrides.delete(threadId);
    if (statusOverrides.size === 0) {
      this.statusOverridesByRuntimeId.delete(runtimeId);
    }
  }

  private withStatusOverrides(
    runtimeId: string,
    inventory: CodexThreadInventory,
  ): CodexThreadInventory {
    const statusOverrides = this.statusOverridesByRuntimeId.get(runtimeId);
    if (!statusOverrides || statusOverrides.size === 0) {
      return inventory;
    }
    let projected: CodexThreadInventory | null = null;
    for (const [threadId, status] of statusOverrides) {
      const thread = inventory.threadsById.get(threadId);
      if (!thread) {
        continue;
      }
      if (!projected) {
        projected = {
          runtimeId: inventory.runtimeId,
          loadedIds: new Set(inventory.loadedIds),
          threadsById: new Map(inventory.threadsById),
        };
      }
      projected.loadedIds.add(threadId);
      projected.threadsById.set(threadId, { ...thread, status });
    }
    return projected ?? inventory;
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
    if (thread.status.classification === "idle") {
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
    this.clearInventory(runtimeId);
    await client.threadRead({
      threadId: input.externalSessionId,
      includeTurns: false,
    });
    return true;
  }

  async readThreadHistory(
    client: CodexAppServerClient,
    input: { externalSessionId: string; workingDirectory: string },
  ): Promise<unknown | null> {
    let response: unknown;
    try {
      response = await this.readThreadWithTurns(client, input.externalSessionId);
    } catch (error) {
      if (isCodexThreadNotLoadedError(error)) {
        return null;
      }
      throw error;
    }
    const thread = threadSnapshotFromReadResponse(response);
    if (!thread || thread.cwd !== input.workingDirectory) {
      return null;
    }
    return response;
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
    return {
      runtimeId,
      loadedIds,
      threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    };
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
