import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
  useWorkspaceSessionSelection,
  workspaceSessionSelectionStorageKey,
} from "./use-workspace-session-selection";

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
    expect(h.result.current).toEqual({ selected: null, missingSessionId: "Archived" });
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
