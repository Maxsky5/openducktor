import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  emptySessionPanelLayout,
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

describe("session panel layout store", () => {
  test("restores a saved layout once and keeps it in memory", () => {
    const owner = taskOwner();
    storage.setItem(
      sessionPanelLayoutStorageKey(owner),
      JSON.stringify({
        version: 1,
        panels: { right: ["files", "diffs"], bottom: [] },
        closedKinds: ["document"],
        selectedRight: { build: "files" },
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

  test("uses the default layout and reports a saved layout that it cannot read once", () => {
    const owner = taskOwner();
    storage.setItem(
      sessionPanelLayoutStorageKey(owner),
      JSON.stringify({ version: 1, panels: { right: ["browser"], bottom: [] } }),
    );

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
    const saved = storage.getItem(key);
    expect(JSON.parse(saved ?? "null")).toEqual({
      version: 1,
      panels: { right: ["diffs"], bottom: [] },
      closedKinds: [],
      selectedRight: {},
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
    }));

    expect(JSON.parse(storage.getItem(sessionPanelLayoutStorageKey(owner)) ?? "null")).toEqual({
      version: 1,
      panels: { right: ["diffs", "files"], bottom: [] },
      closedKinds: ["document"],
      selectedRight: { spec: "files", build: null },
    });
  });
});
