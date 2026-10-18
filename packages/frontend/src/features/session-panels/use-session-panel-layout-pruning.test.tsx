import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, type RenderHookResult, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { WorkspacePresenceContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
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

const inactiveWorkspace = createWorkspaceRecordFixture({
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
  repoPath: "/inactive",
  isActive: false,
});

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
  workspaces?: (typeof workspace)[];
  queryClient?: ReturnType<typeof createClientQueryClient>;
};

type PruningView = RenderHookResult<void, unknown> & {
  workspaceState: ReturnType<typeof createWorkspaceStateFixture>;
  connectionState: { current: ClientConnection };
};

const renderPruning = (
  {
    taskIds,
    workspaceRecordsAreCurrent,
    closedWorkspaces,
    workspaces = [workspace],
    queryClient = createClientQueryClient(),
  }: PruningInput,
  client: Partial<HostClient> = {},
): PruningView => {
  const connection = createTestClientConnection({ client, storage, queryClient });
  const connectionState = { current: connection };
  if (taskIds) queryClient.setQueryData(taskQueryKeys.ids(workspace.repoPath), taskIds);
  const workspaceState = createWorkspaceStateFixture({
    activeWorkspace: workspace,
    workspaces,
    closedWorkspaces,
  });
  const presence = createWorkspacePresenceFixture({ workspaceRecordsAreCurrent });
  const view = renderHook(() => useSessionPanelLayoutPruning(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ClientConnectionProvider connection={connectionState.current}>
        <WorkspacePresenceContext.Provider value={presence}>
          <WorkspaceStateContext.Provider value={workspaceState}>
            {children}
          </WorkspaceStateContext.Provider>
        </WorkspacePresenceContext.Provider>
      </ClientConnectionProvider>
    ),
  });
  return {
    ...view,
    workspaceState,
    connectionState,
    unmount: () => {
      view.unmount();
      queryClient.clear();
    },
  };
};

const chatRecord = (id: string, archived = false): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/inactive" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: archived ? 2000 : null,
});

const cachedLists = (): ReturnType<typeof createClientQueryClient> => {
  const queryClient = createClientQueryClient();
  queryClient.setDefaultOptions({
    queries: {
      ...queryClient.getDefaultOptions().queries,
      refetchOnMount: false,
      retryOnMount: false,
    },
  });
  for (const entry of [workspace, inactiveWorkspace]) {
    queryClient.setQueryData(taskQueryKeys.ids(entry.repoPath), [
      "kept",
      "removed",
      "closed-long-ago",
    ]);
    queryClient.setQueryData(workspaceSessionQueryKeys.ids(entry.workspaceId), [
      "kept",
      "removed",
      "archived",
    ]);
    queryClient.setQueryData(workspaceSessionQueryKeys.list(entry.workspaceId, false), [
      chatRecord("kept"),
      chatRecord("removed"),
    ]);
    queryClient.setQueryData(workspaceSessionQueryKeys.list(entry.workspaceId, true), [
      chatRecord("archived", true),
    ]);
  }
  return queryClient;
};

const current: PruningInput = {
  taskIds: ["kept", "closed-long-ago"],
  workspaceRecordsAreCurrent: true,
  closedWorkspaces: [closedWorkspace],
};

describe("useSessionPanelLayoutPruning", () => {
  test("prunes each host's storage when identical workspace lists belong to another connection", async () => {
    const firstStorage = storage;
    const view = renderPruning({ ...current, queryClient: cachedLists() });
    const owner: SessionPanelOwner = {
      kind: "task",
      workspaceId: workspace.workspaceId,
      taskId: "not-listed",
    };
    saveLayout(owner);
    storage = createMemoryClientStorage();
    saveLayout(owner);
    const nextQueries = cachedLists();
    nextQueries.setQueryData(taskQueryKeys.ids(workspace.repoPath), current.taskIds);
    const next = createTestClientConnection({ storage, queryClient: nextQueries });
    try {
      view.connectionState.current = next;
      await act(async () => view.rerender());
      expect(isSaved(owner)).toBe(false);
      expect(firstStorage.getItem(sessionPanelLayoutStorageKey(owner))).not.toBeNull();
    } finally {
      view.unmount();
      await next.dispose();
    }
  });

  test("keeps layouts outside the archive display while pruning absent chat IDs", () => {
    const queryClient = cachedLists();
    const { workspaceId } = inactiveWorkspace;
    const archived = Array.from({ length: 102 }, (_, index) =>
      chatRecord(`archived-${index}`, true),
    );
    queryClient.setQueryData(workspaceSessionQueryKeys.list(workspaceId, true), archived.slice(2));
    queryClient.setQueryData(workspaceSessionQueryKeys.list(workspaceId, false), [
      { ...chatRecord("draft"), externalSessionId: null },
    ]);
    queryClient.setQueryData(workspaceSessionQueryKeys.ids(workspaceId), [
      ...archived.map(({ id }) => id),
      "draft",
    ]);
    const owners: SessionPanelOwner[] = ["archived-0", "draft", "deleted"].map((sessionId) => ({
      kind: "chat",
      workspaceId,
      sessionId,
    }));
    for (const owner of owners) saveLayout(owner);
    const view = renderPruning({
      ...current,
      workspaces: [workspace, inactiveWorkspace],
      queryClient,
    });
    try {
      expect(owners.map(isSaved)).toEqual([true, true, false]);
    } finally {
      view.unmount();
    }
  });

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

  test("prunes deleted tasks and chats in an inactive open workspace from cache updates", async () => {
    const queryClient = cachedLists();
    const owners: SessionPanelOwner[] = [workspace, inactiveWorkspace].flatMap(
      ({ workspaceId }) => [
        { kind: "task", workspaceId, taskId: "removed" },
        { kind: "task", workspaceId, taskId: "kept" },
        { kind: "task", workspaceId, taskId: "closed-long-ago" },
        { kind: "chat", workspaceId, sessionId: "removed" },
        { kind: "chat", workspaceId, sessionId: "kept" },
        { kind: "chat", workspaceId, sessionId: "archived" },
      ],
    );
    for (const owner of owners) saveLayout(owner);
    const view = renderPruning({
      ...current,
      taskIds: null,
      workspaces: [workspace, inactiveWorkspace],
      queryClient,
    });
    try {
      expect(owners.filter((owner) => !isSaved(owner))).toEqual([]);
      await act(async () => {
        queryClient.setQueryData(taskQueryKeys.ids(inactiveWorkspace.repoPath), [
          "kept",
          "closed-long-ago",
        ]);
        queryClient.setQueryData(workspaceSessionQueryKeys.ids(inactiveWorkspace.workspaceId), [
          "kept",
          "archived",
        ]);
      });
      await waitFor(
        () => {
          expect(owners.filter((owner) => !isSaved(owner))).toEqual([
            { kind: "task", workspaceId: inactiveWorkspace.workspaceId, taskId: "removed" },
            { kind: "chat", workspaceId: inactiveWorkspace.workspaceId, sessionId: "removed" },
          ]);
        },
        { timeout: 500 },
      );
    } finally {
      view.unmount();
    }
  });

  for (const source of ["tasks", "chats"] as const) {
    test.each(["loading", "refreshing", "failed"] as const)(
      `keeps inactive workspace layouts while ${source} are %s`,
      async (state) => {
        const queryClient = cachedLists();
        const key =
          source === "tasks"
            ? taskQueryKeys.ids(inactiveWorkspace.repoPath)
            : workspaceSessionQueryKeys.ids(inactiveWorkspace.workspaceId);
        const owner: SessionPanelOwner =
          source === "tasks"
            ? { kind: "task", workspaceId: inactiveWorkspace.workspaceId, taskId: "not-listed" }
            : { kind: "chat", workspaceId: inactiveWorkspace.workspaceId, sessionId: "not-listed" };
        saveLayout(owner);
        if (state === "loading") queryClient.removeQueries({ queryKey: key });
        const pending = Promise.withResolvers<[]>();
        const read = queryClient
          .fetchQuery({ queryKey: key, queryFn: () => pending.promise, staleTime: 0 })
          .catch(() => undefined);
        if (state === "failed") {
          pending.reject(new Error("List unavailable"));
          await read;
        }
        const view = renderPruning({
          ...current,
          workspaces: [workspace, inactiveWorkspace],
          queryClient,
        });
        try {
          expect(isSaved(owner)).toBe(true);
          if (state === "failed") {
            await act(async () => {
              await queryClient.fetchQuery({
                queryKey: key,
                queryFn: async () => [],
                staleTime: 0,
              });
            });
          } else {
            await act(async () => {
              pending.resolve([]);
              await read;
            });
          }
          await waitFor(() => expect(isSaved(owner)).toBe(false), { timeout: 500 });
        } finally {
          view.unmount();
        }
      },
    );
  }

  test("does not prune unchanged lists when another workspace or owner list changes", async () => {
    const queryClient = cachedLists();
    const view = renderPruning({
      ...current,
      workspaces: [workspace, inactiveWorkspace],
      queryClient,
    });
    const newTask: SessionPanelOwner = {
      kind: "task",
      workspaceId: workspace.workspaceId,
      taskId: "new-task",
    };
    const newChat: SessionPanelOwner = {
      kind: "chat",
      workspaceId: inactiveWorkspace.workspaceId,
      sessionId: "new-chat",
    };
    saveLayout(newTask);
    saveLayout(newChat);
    try {
      await act(async () => {
        queryClient.setQueryData(taskQueryKeys.ids(inactiveWorkspace.repoPath), ["kept"]);
        queryClient.setQueryData(workspaceSessionQueryKeys.ids(workspace.workspaceId), []);
      });
      expect([newTask, newChat].map(isSaved)).toEqual([true, true]);
    } finally {
      view.unmount();
    }
  });

  test("does not reapply an unchanged owner list when open workspaces reorder", async () => {
    const queryClient = cachedLists();
    queryClient.setQueryData(taskQueryKeys.ids(inactiveWorkspace.repoPath), ["inactive-task"]);
    queryClient.setQueryData(workspaceSessionQueryKeys.ids(inactiveWorkspace.workspaceId), [
      "inactive-chat",
    ]);
    const view = renderPruning({
      ...current,
      workspaces: [workspace, inactiveWorkspace],
      queryClient,
    });
    const owners: SessionPanelOwner[] = [workspace, inactiveWorkspace].flatMap(
      ({ workspaceId }) => [
        { kind: "task", workspaceId, taskId: "new-task" },
        { kind: "chat", workspaceId, sessionId: "new-chat" },
      ],
    );
    for (const owner of owners) saveLayout(owner);
    try {
      view.workspaceState.workspaces = [inactiveWorkspace, workspace];
      await act(async () => view.rerender());
      expect(owners.map(isSaved)).toEqual([true, true, true, true]);
    } finally {
      view.unmount();
    }
  });

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
