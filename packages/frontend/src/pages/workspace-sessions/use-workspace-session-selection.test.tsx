import { afterEach, beforeEach, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
  useWorkspaceSessionSelection,
  workspaceSessionSelectionStorageKey,
} from "./use-workspace-session-selection";

const overrideStorage = (overrides: Partial<Pick<Storage, "getItem" | "setItem">>) => {
  const storage = localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return storage.length;
      },
      clear: () => storage.clear(),
      key: (index: number) => storage.key(index),
      getItem: (key: string) => storage.getItem(key),
      setItem: (key: string, value: string) => storage.setItem(key, value),
      removeItem: (key: string) => storage.removeItem(key),
      ...overrides,
    } satisfies Storage,
  });
};

let storageDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
});
afterEach(() => {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
});

const record = (id: string): WorkspaceSession => ({
  id,
  runtimeKind: "opencode",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: id,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

test("selection commits before the scheduled storage write and unmount flushes the last ID", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  localStorage.setItem(key, "First");
  const commits: Array<{ selected: string | undefined; stored: string | null }> = [];
  const sessions = [record("First"), record("Second")];
  const h = renderHook<WorkspaceSession | null, string | undefined>(
    (requestedSessionId: string | undefined) => {
      const { selected } = useWorkspaceSessionSelection({
        workspaceId,
        sessions,
        requestedSessionId,
      });
      useLayoutEffect(() => {
        commits.push({ selected: selected?.id, stored: localStorage.getItem(key) });
      }, [selected]);
      return selected;
    },
    { initialProps: undefined },
  );
  try {
    h.rerender("Second");
    expect(h.result.current?.id).toBe("Second");
    expect(commits.at(-1)).toEqual({ selected: "Second", stored: "First" });
    expect(localStorage.getItem(key)).toBe("First");
    h.unmount();
    expect(localStorage.getItem(key)).toBe("Second");
  } finally {
    h.unmount();
    localStorage.removeItem(key);
  }
});

test("replaces a stale saved ID and clears it only after the loaded list becomes empty", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  localStorage.setItem(key, "Archived");
  const h = renderHook<WorkspaceSession | null, WorkspaceSession[] | undefined>(
    (sessions: WorkspaceSession[] | undefined) =>
      useWorkspaceSessionSelection({ workspaceId, sessions, requestedSessionId: undefined })
        .selected,
    { initialProps: undefined },
  );
  try {
    expect(localStorage.getItem(key)).toBe("Archived");
    h.rerender([record("First")]);
    expect(h.result.current?.id).toBe("First");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(key)).toBe("First");
    h.rerender([]);
    expect(h.result.current).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(key)).toBeNull();
  } finally {
    h.unmount();
    localStorage.removeItem(key);
  }
});

test("keeps a missing requested chat unselected and keeps the saved selection", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  localStorage.setItem(key, "First");
  const h = renderHook(() =>
    useWorkspaceSessionSelection({
      workspaceId,
      sessions: [record("First"), record("Second")],
      requestedSessionId: "Archived",
    }),
  );
  try {
    expect(h.result.current.selected).toBeNull();
    expect(h.result.current.missingSessionId).toBe("Archived");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(key)).toBe("First");
  } finally {
    h.unmount();
    localStorage.removeItem(key);
  }
});

test("restores each workspace's saved chat when the page stays mounted", () => {
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const keyA = workspaceSessionSelectionStorageKey(workspaceA);
  const keyB = workspaceSessionSelectionStorageKey(workspaceB);
  localStorage.setItem(keyA, "First");
  localStorage.setItem(keyB, "Second");
  const sessions = [record("First"), record("Second")];
  const h = renderHook(
    (workspaceId: string) =>
      useWorkspaceSessionSelection({ workspaceId, sessions, requestedSessionId: undefined }),
    { initialProps: workspaceA },
  );
  try {
    h.rerender(workspaceB);
    expect(h.result.current.selected?.id).toBe("Second");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(keyA)).toBe("First");
    expect(localStorage.getItem(keyB)).toBe("Second");
    h.rerender(workspaceA);
    expect(h.result.current.selected?.id).toBe("First");
  } finally {
    h.unmount();
    localStorage.removeItem(keyA);
    localStorage.removeItem(keyB);
  }
});

test.each([undefined, "Second", "First"])(
  "keeps storage failures scoped and retries the intended selection with request %s",
  (requestedSessionId) => {
    const workspaceId = crypto.randomUUID();
    const key = workspaceSessionSelectionStorageKey(workspaceId);
    localStorage.setItem(key, "Second");
    const getItem = localStorage.getItem.bind(localStorage);
    const setItem = localStorage.setItem.bind(localStorage);
    let denied = true;
    let writes = 0;
    overrideStorage({
      getItem: (storageKey) => {
        if (storageKey === key && denied) throw new Error("Storage denied");
        return getItem(storageKey);
      },
      setItem: (storageKey, value) => {
        if (storageKey === key) {
          writes += 1;
          throw new Error("Write denied");
        }
        setItem(storageKey, value);
      },
    });
    const h = renderHook(() =>
      useWorkspaceSessionSelection({
        workspaceId,
        sessions: [record("First"), record("Second")],
        requestedSessionId,
      }),
    );
    try {
      expect(h.result.current.selected).toBeNull();
      expect(h.result.current.navigationPersistenceOperation).toBe("load");
      expect(h.result.current.navigationPersistenceError?.message).toContain("Storage denied");
      act(() => h.result.current.retryNavigationPersistence());
      expect(h.result.current.navigationPersistenceError?.message).toContain("Storage denied");
      denied = false;
      act(() => h.result.current.retryNavigationPersistence());
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(h.result.current.selected?.id).toBe(requestedSessionId ?? "Second");
      expect(getItem(key)).toBe("Second");
      if (requestedSessionId === "First") {
        expect(writes).toBe(1);
        expect(h.result.current.navigationPersistenceOperation).toBe("save");
        expect(h.result.current.navigationPersistenceError?.message).toContain("Write denied");
      } else {
        expect(writes).toBe(0);
        expect(h.result.current.navigationPersistenceError).toBeNull();
      }
    } finally {
      h.unmount();
      localStorage.removeItem(key);
    }
  },
);

test("a failed write retries the intended chat and a workspace switch keeps errors scoped", () => {
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const keyA = workspaceSessionSelectionStorageKey(workspaceA);
  const keyB = workspaceSessionSelectionStorageKey(workspaceB);
  const storage = localStorage;
  storage.setItem(keyA, "First");
  storage.setItem(keyB, "First");
  let denied = true;
  let writes = 0;
  overrideStorage({
    setItem: (key, value) => {
      if (key === keyA) {
        writes += 1;
        if (denied) throw new Error("Write denied");
      }
      storage.setItem(key, value);
    },
  });
  const sessions = [record("First"), record("Second")];
  const h = renderHook(
    (workspaceId: string) =>
      useWorkspaceSessionSelection({
        workspaceId,
        sessions,
        requestedSessionId: "Second",
      }),
    { initialProps: workspaceA },
  );
  try {
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(h.result.current.navigationPersistenceError?.message).toContain("Write denied");
    act(() => h.result.current.retryNavigationPersistence());
    expect(h.result.current.navigationPersistenceError?.message).toContain("Write denied");
    expect(writes).toBe(2);
    h.rerender(workspaceB);
    expect(h.result.current.navigationPersistenceError).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(storage.getItem(keyB)).toBe("Second");
    expect(storage.getItem(keyA)).toBe("First");
    h.rerender(workspaceA);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(h.result.current.navigationPersistenceError?.message).toContain("Write denied");
    denied = false;
    act(() => h.result.current.retryNavigationPersistence());
    expect(h.result.current.navigationPersistenceError).toBeNull();
    expect(storage.getItem(keyA)).toBe("Second");
    expect(h.result.current.selected?.id).toBe("Second");
    expect(storage.getItem(keyB)).toBe("Second");
    expect(storage.getItem(keyA)).toBe("Second");
  } finally {
    h.unmount();
    storage.removeItem(keyA);
    storage.removeItem(keyB);
  }
});
