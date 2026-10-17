import { afterEach, describe, expect, test } from "bun:test";
import { RECENT_ITEMS_STORAGE_KEY, RECENT_ITEMS_STORED_LIMIT } from "./constants";
import {
  addRecentItem,
  loadRecentItems,
  readRecentItems,
  useRecentItemsStore,
  type RecentItem,
} from "./recent-items";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { createRemoteHostClient } from "@openducktor/host-client/remote";
import { getHostStorage } from "@/lib/host-storage";

afterEach(() => {
  globalThis.localStorage.removeItem(RECENT_ITEMS_STORAGE_KEY);
});

describe("recent items", () => {
  test("loads the selected host's list without copying local history into remote work", () => {
    const previousBridge = getShellBridge();
    const previousItems = useRecentItemsStore.getState();
    const local: RecentItem[] = [
      { kind: "task", workspaceId: "local", taskId: "local-task", openedAt: 1 },
    ];
    globalThis.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(local));
    const remote = createRemoteHostClient(
      "https://host.example",
      {
        appVersion: "test",
        supportedProtocolVersions: [1],
        requiredCapabilities: [],
        optionalCapabilities: [],
      },
      {
        request: async () => {
          throw new Error("No request expected.");
        },
        openTerminal: async () => {
          throw new Error("No terminal expected.");
        },
      },
      async () => {},
    );
    configureShellBridge({ ...createUnavailableShellBridge(), remoteConnection: remote });
    const remoteStorage = getHostStorage();
    const saved = remoteStorage.getItem(RECENT_ITEMS_STORAGE_KEY);
    try {
      remoteStorage.removeItem(RECENT_ITEMS_STORAGE_KEY);
      loadRecentItems();
      expect(useRecentItemsStore.getState().items).toEqual([]);
      useRecentItemsStore
        .getState()
        .record({ kind: "task", workspaceId: "remote", taskId: "remote-task" });
      expect(useRecentItemsStore.getState().items).toMatchObject([{ workspaceId: "remote" }]);
      expect(JSON.parse(globalThis.localStorage.getItem(RECENT_ITEMS_STORAGE_KEY)!)).toEqual(local);
      configureShellBridge(createUnavailableShellBridge());
      loadRecentItems();
      expect(useRecentItemsStore.getState().items).toEqual(local);
    } finally {
      if (saved === null) remoteStorage.removeItem(RECENT_ITEMS_STORAGE_KEY);
      else remoteStorage.setItem(RECENT_ITEMS_STORAGE_KEY, saved);
      configureShellBridge(previousBridge);
      useRecentItemsStore.setState(previousItems);
    }
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
