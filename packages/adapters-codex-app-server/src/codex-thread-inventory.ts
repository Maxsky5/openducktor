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
} from "./codex-app-server-threads";
import type { CodexAppServerClient } from "./types";

export class CodexThreadInventoryReader {
  private readonly inventoryByRuntimeId = new Map<string, CodexThreadInventory>();
  private readonly pendingInventoryByRuntimeId = new Map<string, Promise<CodexThreadInventory>>();

  clear(runtimeId: string): void {
    this.inventoryByRuntimeId.delete(runtimeId);
    this.pendingInventoryByRuntimeId.delete(runtimeId);
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

  async readLoadedThread(
    client: CodexAppServerClient,
    runtimeId: string,
    input: { externalSessionId: string; workingDirectory: string },
  ): Promise<unknown | null> {
    const thread = await this.findThread(client, runtimeId, input.externalSessionId);
    if (!thread || thread.cwd !== input.workingDirectory) {
      return null;
    }
    if (thread.status.status.type === "idle") {
      try {
        return await client.threadRead({
          threadId: input.externalSessionId,
          includeTurns: false,
        });
      } catch (error) {
        if (!isCodexThreadNotLoadedError(error)) {
          throw error;
        }
      }
    }
    await client.threadResume({
      threadId: input.externalSessionId,
      cwd: input.workingDirectory,
    });
    this.clear(runtimeId);
    return client.threadRead({
      threadId: input.externalSessionId,
      includeTurns: false,
    });
  }

  async attachThreadForHistory(
    client: CodexAppServerClient,
    runtimeId: string,
    input: { externalSessionId: string; workingDirectory: string },
  ): Promise<unknown | null> {
    const inventory = await this.read(client, runtimeId);
    const thread = inventory.threadsById.get(input.externalSessionId) ?? null;
    if (!thread || thread.cwd !== input.workingDirectory) {
      return null;
    }
    if (inventory.loadedIds.has(thread.id)) {
      try {
        return await this.readThreadWithTurns(client, thread.id);
      } catch (error) {
        if (!isCodexThreadNotLoadedError(error)) {
          throw error;
        }
        this.clear(runtimeId);
      }
    }
    const turns = await this.fetchThreadTurns(client, thread.id);
    return {
      thread: {
        id: thread.id,
        cwd: thread.cwd,
        createdAt: Date.parse(thread.startedAt) / 1000,
        status: thread.status.status,
        turns,
      },
    };
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
