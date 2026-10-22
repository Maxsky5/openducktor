import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { withMockedToast } from "@/test-utils/mock-toast";
import { browserTabIdFixture } from "@/test-utils/session-panel-fixtures";
import {
  emptySessionPanelLayout,
  type SessionPanelLayout,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  createSessionPanelLayoutStore,
  type SessionPanelLayoutStore,
  sessionPanelLayoutStorageKey,
} from "./session-panel-layout-store";

const taskOwner = (taskId = "task-1"): SessionPanelOwner => ({
  kind: "task",
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
  taskId,
});

let storage: ClientStorage;
let store: SessionPanelLayoutStore;

beforeEach(() => {
  storage = createMemoryClientStorage();
  store = createSessionPanelLayoutStore(storage);
});

const TAB_1 = browserTabIdFixture(1);
const TAB_2 = browserTabIdFixture(2);

const savedRecord = (owner: SessionPanelOwner) =>
  JSON.parse(storage.getItem(sessionPanelLayoutStorageKey(owner)) ?? "null");

/** A layout with each kind of entry, and selections of saved and unsaved tabs. */
const layoutWithBrowserTabs = (layout: SessionPanelLayout): SessionPanelLayout => ({
  ...layout,
  panels: {
    right: [
      { id: "terminal:tab:1", kind: "terminal", tabId: "tab:1", terminalId: "1" },
      { id: "diffs", kind: "diffs" },
      {
        id: `browser:${TAB_1}`,
        kind: "browser",
        tabId: TAB_1,
      },
    ],
    bottom: [
      {
        id: `browser:${TAB_2}`,
        kind: "browser",
        tabId: TAB_2,
      },
      { id: "new_tab:bottom", kind: "new_tab" },
    ],
  },
  closedKinds: ["document", "files"],
  selectedRight: { build: "terminal:tab:1", spec: `browser:${TAB_1}`, qa: null },
  selectedBottom: `browser:${TAB_2}`,
});

const BROWSER_TABS_RECORD = {
  version: 2,
  panels: {
    right: [{ kind: "diffs" }, { kind: "browser", tabId: TAB_1 }],
    bottom: [{ kind: "browser", tabId: TAB_2 }],
  },
  closedKinds: ["document", "files"],
  selectedRight: { spec: `browser:${TAB_1}`, build: null, qa: null },
  selectedBottom: `browser:${TAB_2}`,
};

describe("session panel layout store", () => {
  test("restores a saved layout once and keeps it in memory", () => {
    const owner = taskOwner();
    storage.setItem(
      sessionPanelLayoutStorageKey(owner),
      JSON.stringify({
        version: 2,
        panels: { right: [{ kind: "files" }, { kind: "diffs" }], bottom: [] },
        closedKinds: ["document"],
        selectedRight: { build: "files" },
        selectedBottom: null,
      }),
    );

    const layout = store.read(owner);

    expect(layout.panels.right.map((entry) => entry.id)).toEqual(["files", "diffs"]);
    expect(layout.closedKinds).toEqual(["document"]);
    expect(layout.selectedRight).toEqual({ build: "files" });
    storage.removeItem(sessionPanelLayoutStorageKey(owner));
    expect(store.read(owner)).toBe(layout);
    expect(store.takeReadError(owner)).toBeNull();
  });

  test("saves browser tabs with their selections, and restores them", () => {
    const owner = taskOwner();

    store.update(owner, layoutWithBrowserTabs);

    expect(savedRecord(owner)).toEqual(BROWSER_TABS_RECORD);
    const restoredOwner = taskOwner();
    storage.setItem(
      sessionPanelLayoutStorageKey(restoredOwner),
      JSON.stringify(BROWSER_TABS_RECORD),
    );
    const restored = store.read(restoredOwner);
    const saved = store.read(owner);
    expect(restored.panels.right).toEqual(saved.panels.right.slice(1));
    expect(restored.panels.bottom).toEqual(saved.panels.bottom.slice(0, 1));
    expect(restored.selectedRight).toEqual({ spec: `browser:${TAB_1}`, build: null, qa: null });
    expect(restored.selectedBottom).toBe(`browser:${TAB_2}`);
  });

  test("upgrades a v1 layout once with its tool tabs, closed kinds, and selections", () => {
    const owner = taskOwner();
    const v1Key = sessionPanelLayoutStorageKey(owner).replace(":v2:", ":v1:");
    storage.setItem(
      v1Key,
      JSON.stringify({
        version: 1,
        panels: { right: ["files", "diffs"], bottom: ["document"] },
        closedKinds: ["ci_checks"],
        selectedRight: { build: "diffs", spec: null },
      }),
    );

    const layout = store.read(owner);

    expect(layout).toEqual({
      panels: {
        right: [
          { id: "files", kind: "files" },
          { id: "diffs", kind: "diffs" },
        ],
        bottom: [{ id: "document", kind: "document" }],
      },
      closedKinds: ["ci_checks"],
      selectedRight: { build: "diffs", spec: null },
      selectedBottom: null,
    });
    expect(storage.getItem(v1Key)).toBeNull();
    expect(savedRecord(owner)).toEqual({
      version: 2,
      panels: {
        right: [{ kind: "files" }, { kind: "diffs" }],
        bottom: [{ kind: "document" }],
      },
      closedKinds: ["ci_checks"],
      selectedRight: { build: "diffs", spec: null },
      selectedBottom: null,
    });
    expect(store.takeReadError(owner)).toBeNull();
  });

  test("removes the v1 layouts of removed owners that no read upgraded", () => {
    const kept = taskOwner("kept");
    const removed: SessionPanelOwner = {
      kind: "task",
      workspaceId: kept.workspaceId,
      taskId: "removed",
    };
    const v1Key = (owner: SessionPanelOwner) =>
      sessionPanelLayoutStorageKey(owner).replace(":v2:", ":v1:");
    for (const owner of [kept, removed]) storage.setItem(v1Key(owner), "{}");

    store.prune({ kind: "tasks", workspaceId: kept.workspaceId, ids: new Set(["kept"]) });

    expect(storage.getItem(v1Key(kept))).toBe("{}");
    expect(storage.getItem(v1Key(removed))).toBeNull();
  });

  test("uses the default layout and reports a saved layout that it cannot read once", () => {
    const owner = taskOwner();
    const record = structuredClone(BROWSER_TABS_RECORD);
    record.panels.bottom[0] = { kind: "browser", tabId: "not-a-tab-id" };
    storage.setItem(sessionPanelLayoutStorageKey(owner), JSON.stringify(record));

    expect(store.read(owner)).toEqual(emptySessionPanelLayout());
    expect(store.takeReadError(owner)).toBeString();
    expect(store.takeReadError(owner)).toBeNull();
  });

  test("saves tool tab changes and keeps live terminal changes in memory only", () => {
    const owner = taskOwner();
    const key = sessionPanelLayoutStorageKey(owner);

    store.update(owner, (layout) => ({
      ...layout,
      panels: { ...layout.panels, right: [{ id: "diffs", kind: "diffs" }] },
    }));
    expect(savedRecord(owner)).toEqual({
      version: 2,
      panels: { right: [{ kind: "diffs" }], bottom: [] },
      closedKinds: [],
      selectedRight: {},
      selectedBottom: null,
    });

    storage.setItem(key, "unchanged marker");
    store.update(owner, (layout) => ({
      ...layout,
      panels: {
        ...layout.panels,
        bottom: [{ id: "terminal:tab:1", kind: "terminal", tabId: "tab:1", terminalId: "1" }],
      },
    }));

    expect(storage.getItem(key)).toBe("unchanged marker");
    expect(
      store
        .snapshot()
        .get(sessionPanelOwnerKey(owner))
        ?.panels.bottom.map((entry) => entry.id),
    ).toEqual(["terminal:tab:1"]);
  });

  test("keeps the layout working and reports a save failure once", async () => {
    const owner = taskOwner();
    const fullStore = createSessionPanelLayoutStore({
      ...createMemoryClientStorage(),
      setItem: () => {
        throw new Error("The storage quota is full.");
      },
    });
    await withMockedToast(async ({ toastErrorMock }) => {
      for (const kind of ["diffs", "files"] as const) {
        fullStore.update(owner, (layout) => ({
          ...layout,
          panels: { ...layout.panels, right: [{ id: kind, kind }] },
        }));
      }

      expect(fullStore.read(owner).panels.right).toEqual([{ id: "files", kind: "files" }]);
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
    });
  });

  test("removes the layouts of tasks, chats, and workspaces that no longer exist", () => {
    const kept = taskOwner("kept");
    const workspaceId = kept.workspaceId;
    const removedTask: SessionPanelOwner = { kind: "task", workspaceId, taskId: "removed" };
    const keptChat: SessionPanelOwner = { kind: "chat", workspaceId, sessionId: "kept-chat" };
    const removedChat: SessionPanelOwner = { kind: "chat", workspaceId, sessionId: "gone" };
    const otherWorkspace = taskOwner("task-1");
    const owners = [kept, removedTask, keptChat, removedChat, otherWorkspace];
    for (const owner of owners) {
      store.update(owner, (layout) => ({
        ...layout,
        panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
      }));
    }

    store.prune({ kind: "workspaces", ids: new Set([workspaceId]) });
    store.prune({ kind: "tasks", workspaceId, ids: new Set(["kept"]) });
    store.prune({ kind: "chats", workspaceId, ids: new Set(["kept-chat"]) });

    const stored = (owner: SessionPanelOwner) =>
      storage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;
    expect(owners.map(stored)).toEqual([true, false, true, false, false]);
    const snapshot = store.snapshot();
    expect(owners.map((owner) => snapshot.has(sessionPanelOwnerKey(owner)))).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  test("removes the records of removed owners, and tells listeners each removed owner once", () => {
    const kept = taskOwner("kept");
    const workspaceId = kept.workspaceId;
    const savedTask: SessionPanelOwner = { kind: "task", workspaceId, taskId: "saved" };
    const oldTask: SessionPanelOwner = { kind: "task", workspaceId, taskId: "old" };
    const memoryChat: SessionPanelOwner = { kind: "chat", workspaceId, sessionId: "chat-1" };
    store.update(savedTask, (layout) => ({
      ...layout,
      panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
    }));
    storage.setItem(sessionPanelLayoutStorageKey(oldTask), "{}");
    store.read(memoryChat);
    const prunes: (readonly SessionPanelOwner[])[] = [];
    const unsubscribe = store.subscribePrunes((owners) => prunes.push(owners));

    try {
      store.prune({ kind: "tasks", workspaceId, ids: new Set(["kept"]) });
      store.prune({ kind: "tasks", workspaceId, ids: new Set(["kept"]) });
      store.prune({ kind: "chats", workspaceId, ids: new Set() });
    } finally {
      unsubscribe();
    }
    store.prune({ kind: "tasks", workspaceId, ids: new Set() });

    expect(storage.getItem(sessionPanelLayoutStorageKey(savedTask))).toBeNull();
    expect(storage.getItem(sessionPanelLayoutStorageKey(oldTask))).toBeNull();

    expect(prunes).toHaveLength(2);
    expect(prunes[0]).toHaveLength(2);
    expect(prunes[0]).toEqual(expect.arrayContaining([savedTask, oldTask]));
    expect(prunes[1]).toEqual([memoryChat]);
  });

  test("reports a storage failure during cleanup instead of breaking the page", async () => {
    const blockedStore = createSessionPanelLayoutStore({
      ...createMemoryClientStorage(),
      get length(): number {
        throw new Error("Site data is blocked.");
      },
    });
    await withMockedToast(async ({ toastErrorMock }) => {
      const prune = () => blockedStore.prune({ kind: "workspaces", ids: new Set() });

      prune();
      prune();

      expect(toastErrorMock).toHaveBeenCalledTimes(1);
    });
  });

  test("removes with a task list only the task layouts of its own workspace", () => {
    const task = taskOwner();
    const chat: SessionPanelOwner = {
      kind: "chat",
      workspaceId: task.workspaceId,
      sessionId: "chat-1",
    };
    const otherTask = taskOwner();
    for (const owner of [task, chat, otherTask]) {
      store.update(owner, (layout) => ({
        ...layout,
        panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
      }));
    }

    store.prune({ kind: "tasks", workspaceId: task.workspaceId, ids: new Set() });

    const stored = (owner: SessionPanelOwner) =>
      storage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;
    expect([task, chat, otherTask].map(stored)).toEqual([false, true, true]);
  });

  test("saves tool tabs only, and a selected terminal as a selection whose tab is gone", () => {
    const owner = taskOwner();

    store.update(owner, (layout) => ({
      ...layout,
      panels: {
        right: [
          { id: "terminal:tab:1", kind: "terminal", tabId: "tab:1", terminalId: "1" },
          { id: "diffs", kind: "diffs" },
          { id: "files", kind: "files" },
        ],
        bottom: [{ id: "new_tab:bottom", kind: "new_tab" }],
      },
      closedKinds: ["document"],
      selectedRight: { build: "terminal:tab:1", spec: "files" },
      selectedBottom: "new_tab:bottom",
    }));

    expect(savedRecord(owner)).toEqual({
      version: 2,
      panels: { right: [{ kind: "diffs" }, { kind: "files" }], bottom: [] },
      closedKinds: ["document"],
      selectedRight: { spec: "files", build: null },
      selectedBottom: null,
    });
  });
});
