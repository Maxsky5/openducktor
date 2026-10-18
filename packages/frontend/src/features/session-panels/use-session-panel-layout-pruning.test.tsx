import { beforeEach, describe, expect, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkspacePresenceContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import {
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { SessionPanelOwner } from "./session-panel-layout";
import { sessionPanelLayoutStorageKey } from "./session-panel-layout-store";
import { useSessionPanelLayoutPruning } from "./use-session-panel-layout-pruning";

const workspace = createWorkspaceRecordFixture({
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
});

const closedWorkspace = createWorkspaceRecordFixture({
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
});

// The host storage of the test. Each rendered connection prunes the records in it.
let storage: ClientStorage;

beforeEach(() => {
  storage = createMemoryClientStorage();
});

const saveLayout = (owner: SessionPanelOwner): void =>
  storage.setItem(
    sessionPanelLayoutStorageKey(owner),
    JSON.stringify({
      version: 1,
      panels: { right: ["files"], bottom: [] },
      closedKinds: [],
      selectedRight: {},
    }),
  );

const isSaved = (owner: SessionPanelOwner): boolean =>
  storage.getItem(sessionPanelLayoutStorageKey(owner)) !== null;

type PruningInput = {
  /** The IDs of all tasks that the host lists, or null while the list loads. */
  taskIds: string[] | null;
  workspaceRecordsAreCurrent: boolean;
  closedWorkspaces: (typeof workspace)[];
};

const renderPruning = (
  { taskIds, workspaceRecordsAreCurrent, closedWorkspaces }: PruningInput,
  client: Partial<HostClient> = {},
) => {
  const connection = createTestClientConnection({ client, storage });
  const { queryClient } = connection;
  if (taskIds) queryClient.setQueryData(taskQueryKeys.ids(workspace.repoPath), taskIds);
  const workspaceState = createWorkspaceStateFixture({
    activeWorkspace: workspace,
    workspaces: [workspace],
    closedWorkspaces,
  });
  const presence = createWorkspacePresenceFixture({ workspaceRecordsAreCurrent });
  return renderHook(() => useSessionPanelLayoutPruning(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ClientConnectionProvider connection={connection}>
        <WorkspacePresenceContext.Provider value={presence}>
          <WorkspaceStateContext.Provider value={workspaceState}>
            {children}
          </WorkspaceStateContext.Provider>
        </WorkspacePresenceContext.Provider>
      </ClientConnectionProvider>
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
    for (const owner of [kept, removed]) saveLayout(owner);

    const view = renderPruning(
      { ...current, taskIds: null },
      { taskIdsList: () => new Promise(() => {}) },
    );

    expect([kept, removed].map(isSaved)).toEqual([true, true]);
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
