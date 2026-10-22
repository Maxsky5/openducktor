import { beforeEach, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type ReactNode, useLayoutEffect } from "react";
import {
  useWorkspaceSessionSelection,
  workspaceSessionSelectionStorageKey,
} from "./use-workspace-session-selection";

// `saved` keeps the records. The connection reads them through `hostStorage`, whose methods a test
// can replace with `overrideStorage`.
let saved: ClientStorage;
let hostStorage: ClientStorage;
let connection: ClientConnection;
beforeEach(() => {
  const records = createMemoryClientStorage();
  saved = records;
  hostStorage = {
    get length() {
      return records.length;
    },
    key: (index) => records.key(index),
    getItem: (key) => records.getItem(key),
    setItem: (key, value) => records.setItem(key, value),
    removeItem: (key) => records.removeItem(key),
  };
  connection = createTestClientConnection({ storage: hostStorage });
});

const overrideStorage = (overrides: Partial<Pick<ClientStorage, "getItem" | "setItem">>) => {
  Object.assign(hostStorage, overrides);
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
);

const record = (id: string): WorkspaceSession => ({
  id,
  runtimeKind: "opencode",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: id,
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

test("selection commits before the scheduled storage write and unmount flushes the last ID", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  saved.setItem(key, "First");
  const commits: Array<{ selected: string | undefined; stored: string | null }> = [];
  const sessions = [record("First"), record("Second")];
  const h = renderHook<WorkspaceSession | null, string | undefined>(
    (requestedSessionId: string | undefined) => {
      const { selected } = useWorkspaceSessionSelection({
        isActive: true,
        workspaceId,
        sessions,
        requestedSessionId,
      });
      useLayoutEffect(() => {
        commits.push({ selected: selected?.id, stored: saved.getItem(key) });
      }, [selected]);
      return selected;
    },
    { initialProps: undefined, wrapper },
  );
  try {
    h.rerender("Second");
    expect(h.result.current?.id).toBe("Second");
    expect(commits.at(-1)).toEqual({ selected: "Second", stored: "First" });
    expect(saved.getItem(key)).toBe("First");
    h.unmount();
    expect(saved.getItem(key)).toBe("Second");
  } finally {
    h.unmount();
    saved.removeItem(key);
  }
});

test("replaces a stale saved ID and clears it only after the loaded list becomes empty", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  saved.setItem(key, "Archived");
  const h = renderHook<WorkspaceSession | null, WorkspaceSession[] | undefined>(
    (sessions: WorkspaceSession[] | undefined) =>
      useWorkspaceSessionSelection({
        workspaceId,
        sessions,
        requestedSessionId: undefined,
        isActive: true,
      }).selected,
    { initialProps: undefined, wrapper },
  );
  try {
    expect(saved.getItem(key)).toBe("Archived");
    h.rerender([record("First")]);
    expect(h.result.current?.id).toBe("First");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saved.getItem(key)).toBe("First");
    h.rerender([]);
    expect(h.result.current).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saved.getItem(key)).toBeNull();
  } finally {
    h.unmount();
    saved.removeItem(key);
  }
});

test("keeps a missing requested chat unselected and keeps the saved selection", () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  saved.setItem(key, "First");
  const h = renderHook(
    () =>
      useWorkspaceSessionSelection({
        isActive: true,
        workspaceId,
        sessions: [record("First"), record("Second")],
        requestedSessionId: "Archived",
      }),
    { wrapper },
  );
  try {
    expect(h.result.current.selected).toBeNull();
    expect(h.result.current.missingSessionId).toBe("Archived");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saved.getItem(key)).toBe("First");
  } finally {
    h.unmount();
    saved.removeItem(key);
  }
});

test.each(["idle", "pending"])(
  "restores a saved workspace chat without rewriting it; previous save %s",
  (saveState) => {
    const pendingSave = saveState === "pending";
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    const keyA = workspaceSessionSelectionStorageKey(workspaceA);
    const keyB = workspaceSessionSelectionStorageKey(workspaceB);
    const storage = saved;
    storage.setItem(keyA, "First");
    storage.setItem(keyB, "Second");
    let writes = 0;
    overrideStorage({
      setItem: (key, value) => {
        if (key === keyB) {
          writes += 1;
          throw new Error("Write denied");
        }
        storage.setItem(key, value);
      },
    });
    const sessions = [record("First"), record("Second")];
    const h = renderHook(
      ({
        workspaceId,
        requestedSessionId,
      }: {
        workspaceId: string;
        requestedSessionId: string | undefined;
      }) =>
        useWorkspaceSessionSelection({ workspaceId, sessions, requestedSessionId, isActive: true }),
      {
        initialProps: {
          workspaceId: workspaceA,
          requestedSessionId: pendingSave ? "Second" : undefined,
        },
        wrapper,
      },
    );
    try {
      h.rerender({ workspaceId: workspaceB, requestedSessionId: undefined });
      expect(h.result.current.selected?.id).toBe("Second");
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(h.result.current.navigationPersistenceError).toBeNull();
      expect(writes).toBe(0);
      expect(storage.getItem(keyA)).toBe(pendingSave ? "Second" : "First");
      expect(storage.getItem(keyB)).toBe("Second");
      h.rerender({ workspaceId: workspaceA, requestedSessionId: undefined });
      expect(h.result.current.selected?.id).toBe(pendingSave ? "Second" : "First");
    } finally {
      h.unmount();
      storage.removeItem(keyA);
      storage.removeItem(keyB);
    }
  },
);

test.each([undefined, "Second", "First"])(
  "keeps storage failures scoped and retries the intended selection with request %s",
  (requestedSessionId) => {
    const workspaceId = crypto.randomUUID();
    const key = workspaceSessionSelectionStorageKey(workspaceId);
    saved.setItem(key, "Second");
    const getItem = saved.getItem;
    const setItem = saved.setItem;
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
    const h = renderHook(
      () =>
        useWorkspaceSessionSelection({
          isActive: true,
          workspaceId,
          sessions: [record("First"), record("Second")],
          requestedSessionId,
        }),
      { wrapper },
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
      saved.removeItem(key);
    }
  },
);

test("a failed write retries the intended chat and a workspace switch keeps errors scoped", () => {
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const keyA = workspaceSessionSelectionStorageKey(workspaceA);
  const keyB = workspaceSessionSelectionStorageKey(workspaceB);
  const storage = saved;
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
        isActive: true,
        workspaceId,
        sessions,
        requestedSessionId: "Second",
      }),
    { initialProps: workspaceA, wrapper },
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
