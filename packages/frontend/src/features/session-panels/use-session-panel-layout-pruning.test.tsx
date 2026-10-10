import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { hostClient } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
import { WorkspacePresenceContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { taskQueryKeys } from "@/state/queries/tasks";
import {
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { SessionPanelOwner } from "./session-panel-layout";
import {
  pruneSessionPanelLayouts,
  sessionPanelLayoutStorageKey,
  updateSessionPanelLayout,
} from "./session-panel-layout-store";
import { useSessionPanelLayoutPruning } from "./use-session-panel-layout-pruning";

const workspace = createWorkspaceRecordFixture({
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
});

const closedWorkspace = createWorkspaceRecordFixture({
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
});

afterEach(() => {
  for (const { workspaceId } of [workspace, closedWorkspace]) {
    pruneSessionPanelLayouts({ kind: "tasks", workspaceId, ids: new Set() });
    pruneSessionPanelLayouts({ kind: "chats", workspaceId, ids: new Set() });
  }
});

const saveLayout = (owner: SessionPanelOwner): void =>
  updateSessionPanelLayout(owner, (layout) => ({
    ...layout,
    panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
  }));

const isSaved = (owner: SessionPanelOwner): boolean =>
  localStorage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;

type PruningInput = {
  /** The IDs of all tasks that the host lists, or null while the list loads. */
  taskIds: string[] | null;
  workspaceRecordsAreCurrent: boolean;
  closedWorkspaces: (typeof workspace)[];
};

const renderPruning = ({ taskIds, workspaceRecordsAreCurrent, closedWorkspaces }: PruningInput) => {
  const queryClient = createQueryClient();
  if (taskIds) queryClient.setQueryData(taskQueryKeys.ids(workspace.repoPath), taskIds);
  const workspaceState = createWorkspaceStateFixture({
    activeWorkspace: workspace,
    workspaces: [workspace],
    closedWorkspaces,
  });
  const presence = createWorkspacePresenceFixture({ workspaceRecordsAreCurrent });
  return renderHook(() => useSessionPanelLayoutPruning(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <WorkspacePresenceContext.Provider value={presence}>
          <WorkspaceStateContext.Provider value={workspaceState}>
            {children}
          </WorkspaceStateContext.Provider>
        </WorkspacePresenceContext.Provider>
      </QueryClientProvider>
    ),
  });
};

const current: PruningInput = {
  taskIds: ["kept", "closed-long-ago"],
  workspaceRecordsAreCurrent: true,
  closedWorkspaces: [closedWorkspace],
};

describe("useSessionPanelLayoutPruning", () => {
  const kept: SessionPanelOwner = {
    kind: "task",
    workspaceId: workspace.workspaceId,
    taskId: "kept",
  };
  const removed: SessionPanelOwner = {
    kind: "task",
    workspaceId: workspace.workspaceId,
    taskId: "removed",
  };
  const chat: SessionPanelOwner = {
    kind: "chat",
    workspaceId: workspace.workspaceId,
    sessionId: "chat-1",
  };

  test("removes the layouts of tasks that the host no longer has, and keeps hidden closed tasks", () => {
    // The Kanban list hides the old closed task, but the host still lists its ID.
    const closedLongAgo: SessionPanelOwner = {
      kind: "task",
      workspaceId: workspace.workspaceId,
      taskId: "closed-long-ago",
    };
    for (const owner of [kept, removed, closedLongAgo, chat]) saveLayout(owner);

    const view = renderPruning(current);

    expect([kept, removed, closedLongAgo, chat].map(isSaved)).toEqual([true, false, true, true]);
    view.unmount();
  });

  test("keeps every task layout while the task ID list loads", () => {
    const loading = spyOn(hostClient, "taskIdsList").mockReturnValue(new Promise(() => {}));
    for (const owner of [kept, removed]) saveLayout(owner);

    const view = renderPruning({ ...current, taskIds: null });

    expect([kept, removed].map(isSaved)).toEqual([true, true]);
    loading.mockRestore();
    view.unmount();
  });

  test("keeps the layouts of a closed workspace until both workspace lists are current", () => {
    const closedTask: SessionPanelOwner = {
      kind: "task",
      workspaceId: closedWorkspace.workspaceId,
      taskId: "closed-task",
    };
    saveLayout(closedTask);

    // The closed workspace list is still loading.
    const loading = renderPruning({
      ...current,
      workspaceRecordsAreCurrent: false,
      closedWorkspaces: [],
    });
    expect(isSaved(closedTask)).toBe(true);
    loading.unmount();

    const loaded = renderPruning(current);
    expect(isSaved(closedTask)).toBe(true);
    loaded.unmount();

    // The workspace was removed, so it is in neither list.
    const removedWorkspace = renderPruning({ ...current, closedWorkspaces: [] });
    expect(isSaved(closedTask)).toBe(false);
    removedWorkspace.unmount();
  });
});
