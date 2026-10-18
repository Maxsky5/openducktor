import { afterEach, describe, expect, test } from "bun:test";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { RECENT_ITEMS_STORAGE_KEY, RECENT_ITEMS_STORED_LIMIT } from "./constants";
import { addRecentItem, readRecentItems, type RecentItem, useRecentItems } from "./recent-items";

afterEach(cleanup);

const renderRecentItems = (storage: ClientStorage) => {
  const connection = createTestClientConnection({ storage });
  return renderHook(() => useRecentItems((store) => store), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(ClientConnectionProvider, { connection }, children),
  });
};

describe("recent items", () => {
  test("keeps the Recent list of each host connection apart", () => {
    const local: RecentItem[] = [
      { kind: "task", workspaceId: "local", taskId: "local-task", openedAt: 1 },
    ];
    const localStorage = createMemoryClientStorage();
    localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(local));
    // The bootstrap gives a remote host connection memory storage.
    const remote = renderRecentItems(createMemoryClientStorage());
    const localHost = renderRecentItems(localStorage);

    expect(remote.result.current.items).toEqual([]);
    act(() =>
      remote.result.current.record({ kind: "task", workspaceId: "remote", taskId: "remote-task" }),
    );

    expect(remote.result.current.items).toMatchObject([{ workspaceId: "remote" }]);
    expect(localHost.result.current.items).toEqual(local);
    expect(JSON.parse(localStorage.getItem(RECENT_ITEMS_STORAGE_KEY) ?? "null")).toEqual(local);
  });

  test("puts the opened item first and drops its older copy", () => {
    const items: RecentItem[] = [
      { kind: "task", workspaceId: "w1", taskId: "T-1", openedAt: 2 },
      { kind: "chat", workspaceId: "w1", sessionId: "C-1", openedAt: 1 },
    ];

    expect(addRecentItem(items, { kind: "chat", workspaceId: "w1", sessionId: "C-1" }, 3)).toEqual([
      { kind: "chat", workspaceId: "w1", sessionId: "C-1", openedAt: 3 },
      { kind: "task", workspaceId: "w1", taskId: "T-1", openedAt: 2 },
    ]);
  });

  test("keeps the same task of two workspaces apart", () => {
    const items = addRecentItem([], { kind: "task", workspaceId: "w1", taskId: "T-1" }, 1);

    expect(
      addRecentItem(items, { kind: "task", workspaceId: "w2", taskId: "T-1" }, 2),
    ).toHaveLength(2);
  });

  test("keeps only the newest items", () => {
    let items: RecentItem[] = [];
    for (let index = 0; index <= RECENT_ITEMS_STORED_LIMIT; index += 1) {
      items = addRecentItem(items, { kind: "task", workspaceId: "w", taskId: `T-${index}` }, index);
    }

    expect(items).toHaveLength(RECENT_ITEMS_STORED_LIMIT);
    expect(items[0]).toMatchObject({ taskId: `T-${RECENT_ITEMS_STORED_LIMIT}` });
    expect(items.some((item) => item.kind === "task" && item.taskId === "T-0")).toBe(false);
  });

  test("reads a saved list and reports an invalid one", () => {
    const storage = createMemoryClientStorage();
    expect(readRecentItems(storage)).toEqual({ items: [], error: null });

    const saved: RecentItem[] = [{ kind: "task", workspaceId: "w1", taskId: "T-1", openedAt: 1 }];
    storage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(saved));
    expect(readRecentItems(storage)).toEqual({ items: saved, error: null });

    storage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify([{ kind: "page" }]));
    expect(readRecentItems(storage)).toEqual({
      items: [],
      error: "The saved list of recent tasks and chats is invalid.",
    });

    storage.setItem(RECENT_ITEMS_STORAGE_KEY, "{");
    expect(readRecentItems(storage).items).toEqual([]);
    expect(readRecentItems(storage).error).not.toBeNull();
  });
});
