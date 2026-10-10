import { afterEach, describe, expect, test } from "bun:test";
import { RECENT_ITEMS_STORAGE_KEY, RECENT_ITEMS_STORED_LIMIT } from "./constants";
import { addRecentItem, readRecentItems, type RecentItem } from "./recent-items";

afterEach(() => {
  globalThis.localStorage.removeItem(RECENT_ITEMS_STORAGE_KEY);
});

describe("recent items", () => {
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
    expect(readRecentItems()).toEqual({ items: [], error: null });

    const saved: RecentItem[] = [{ kind: "task", workspaceId: "w1", taskId: "T-1", openedAt: 1 }];
    globalThis.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(saved));
    expect(readRecentItems()).toEqual({ items: saved, error: null });

    globalThis.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify([{ kind: "page" }]));
    expect(readRecentItems()).toEqual({
      items: [],
      error: "The saved list of recent tasks and chats is invalid.",
    });

    globalThis.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, "{");
    expect(readRecentItems().items).toEqual([]);
    expect(readRecentItems().error).not.toBeNull();
  });
});
