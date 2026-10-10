import { afterEach, describe, expect, test } from "bun:test";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  emptySessionPanelLayout,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  pruneSessionPanelLayouts,
  readSessionPanelLayout,
  sessionPanelLayoutStorageKey,
  sessionPanelLayoutsSnapshot,
  takeSessionPanelLayoutReadError,
  updateSessionPanelLayout,
} from "./session-panel-layout-store";

const workspaceIds = new Set<string>();

/** Each test uses its own workspace, because the store is shared by the test process. */
const taskOwner = (taskId = "task-1"): SessionPanelOwner => {
  const workspaceId = `workspace-${globalThis.crypto.randomUUID()}`;
  workspaceIds.add(workspaceId);
  return { kind: "task", workspaceId, taskId };
};

afterEach(() => {
  for (const workspaceId of workspaceIds) {
    pruneSessionPanelLayouts({ kind: "tasks", workspaceId, ids: new Set() });
    pruneSessionPanelLayouts({ kind: "chats", workspaceId, ids: new Set() });
  }
  workspaceIds.clear();
});

describe("session panel layout store", () => {
  test("restores a saved layout once and keeps it in memory", () => {
    const owner = taskOwner();
    localStorage.setItem(
      sessionPanelLayoutStorageKey(owner),
      JSON.stringify({
        version: 1,
        panels: { right: ["files", "diffs"], bottom: [] },
        closedKinds: ["document"],
        selectedRight: { build: "files" },
      }),
    );

    const layout = readSessionPanelLayout(owner);

    expect(layout.panels.right.map((entry) => entry.id)).toEqual(["files", "diffs"]);
    expect(layout.closedKinds).toEqual(["document"]);
    expect(layout.selectedRight).toEqual({ build: "files" });
    localStorage.removeItem(sessionPanelLayoutStorageKey(owner));
    expect(readSessionPanelLayout(owner)).toBe(layout);
    expect(takeSessionPanelLayoutReadError(owner)).toBeNull();
  });

  test("uses the default layout and reports a saved layout that it cannot read once", () => {
    const owner = taskOwner();
    localStorage.setItem(
      sessionPanelLayoutStorageKey(owner),
      JSON.stringify({ version: 1, panels: { right: ["browser"], bottom: [] } }),
    );

    expect(readSessionPanelLayout(owner)).toEqual(emptySessionPanelLayout());
    expect(takeSessionPanelLayoutReadError(owner)).toBeString();
    expect(takeSessionPanelLayoutReadError(owner)).toBeNull();
  });

  test("saves tool tab changes and keeps live terminal changes in memory only", () => {
    const owner = taskOwner();
    const key = sessionPanelLayoutStorageKey(owner);

    updateSessionPanelLayout(owner, (layout) => ({
      ...layout,
      panels: { ...layout.panels, right: [{ id: "diffs", kind: "diffs" }] },
    }));
    const saved = localStorage.getItem(key);
    expect(JSON.parse(saved ?? "null")).toEqual({
      version: 1,
      panels: { right: ["diffs"], bottom: [] },
      closedKinds: [],
      selectedRight: {},
    });

    localStorage.setItem(key, "unchanged marker");
    updateSessionPanelLayout(owner, (layout) => ({
      ...layout,
      panels: {
        ...layout.panels,
        bottom: [{ id: "terminal:tab:1", kind: "terminal", tabId: "tab:1", terminalId: "1" }],
      },
    }));

    expect(localStorage.getItem(key)).toBe("unchanged marker");
    expect(
      sessionPanelLayoutsSnapshot()
        .get(sessionPanelOwnerKey(owner))
        ?.panels.bottom.map((entry) => entry.id),
    ).toEqual(["terminal:tab:1"]);
  });

  test("keeps the layout working and reports a save failure once", async () => {
    const owner = taskOwner();
    const realStorage = globalThis.localStorage;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const fullStorage: Storage = {
      get length() {
        return realStorage.length;
      },
      clear: () => realStorage.clear(),
      key: (index) => realStorage.key(index),
      getItem: (key) => realStorage.getItem(key),
      removeItem: (key) => realStorage.removeItem(key),
      setItem: () => {
        throw new Error("The storage quota is full.");
      },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fullStorage });
    try {
      await withMockedToast(async ({ toastErrorMock }) => {
        for (const kind of ["diffs", "files"] as const) {
          updateSessionPanelLayout(owner, (layout) => ({
            ...layout,
            panels: { ...layout.panels, right: [{ id: kind, kind }] },
          }));
        }

        expect(readSessionPanelLayout(owner).panels.right).toEqual([
          { id: "files", kind: "files" },
        ]);
        expect(toastErrorMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
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
      updateSessionPanelLayout(owner, (layout) => ({
        ...layout,
        panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
      }));
    }

    pruneSessionPanelLayouts({ kind: "workspaces", ids: new Set([workspaceId]) });
    pruneSessionPanelLayouts({ kind: "tasks", workspaceId, ids: new Set(["kept"]) });
    pruneSessionPanelLayouts({ kind: "chats", workspaceId, ids: new Set(["kept-chat"]) });

    const stored = (owner: SessionPanelOwner) =>
      localStorage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;
    expect(owners.map(stored)).toEqual([true, false, true, false, false]);
    const snapshot = sessionPanelLayoutsSnapshot();
    expect(owners.map((owner) => snapshot.has(sessionPanelOwnerKey(owner)))).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  test("reports a storage failure during cleanup instead of breaking the page", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Site data is blocked.");
      },
    });
    try {
      await withMockedToast(async ({ toastErrorMock }) => {
        const prune = () => pruneSessionPanelLayouts({ kind: "workspaces", ids: new Set() });

        prune();
        prune();

        expect(toastErrorMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
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
      updateSessionPanelLayout(owner, (layout) => ({
        ...layout,
        panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
      }));
    }

    pruneSessionPanelLayouts({ kind: "tasks", workspaceId: task.workspaceId, ids: new Set() });

    const stored = (owner: SessionPanelOwner) =>
      localStorage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;
    expect([task, chat, otherTask].map(stored)).toEqual([false, true, true]);
  });

  test("saves tool tabs only, and a selected terminal as a selection whose tab is gone", () => {
    const owner = taskOwner();

    updateSessionPanelLayout(owner, (layout) => ({
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

    expect(JSON.parse(localStorage.getItem(sessionPanelLayoutStorageKey(owner)) ?? "null")).toEqual(
      {
        version: 1,
        panels: { right: ["diffs", "files"], bottom: [] },
        closedKinds: ["document"],
        selectedRight: { spec: "files", build: null },
      },
    );
  });
});
