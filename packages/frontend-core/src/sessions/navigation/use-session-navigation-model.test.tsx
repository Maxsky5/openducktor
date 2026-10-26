import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  SidebarSessionGrouping,
  WorkspaceSession,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkspaceSessionLiveFacts } from "../../workspace-activity/workspace-activity-state";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { workspaceSessionQueryKeys } from "../../queries/workspace-sessions";
import type { SessionNavigationWorkspace } from "./session-navigation-read-model";
import { WorkspaceActivityContext } from "../../workspace-activity/workspace-activity-context";
import {
  createTaskCardFixture,
  createWorkspaceActivityObserverStub,
} from "../../test-support/shared-test-fixtures";
import { useSessionNavigationModel } from "./use-session-navigation-model";

const alpha: SessionNavigationWorkspace = {
  workspaceId: "alpha",
  workspaceName: "Alpha",
  repoPath: "/alpha",
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
};
const beta: SessionNavigationWorkspace = {
  ...alpha,
  workspaceId: "beta",
  workspaceName: "Beta",
  repoPath: "/beta",
};

const record = (
  externalSessionId: string,
  workingDirectory: string,
  startedAt: string,
): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  runtimeKind: "codex",
  workingDirectory,
  startedAt,
  selectedModel: null,
});

const chat = (id: string, workingDirectory: string, updatedAt: number): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${id}`,
  manualTitle: null,
  targetBranch: null,
  createdAt: updatedAt,
  lastActivityAt: updatedAt,
  updatedAt,
  archivedAt: null,
});

const facts = (overrides: Partial<WorkspaceSessionLiveFacts>): WorkspaceSessionLiveFacts => ({
  activityState: "idle",
  pendingQuestion: false,
  pendingPermission: false,
  pendingInputs: new Set(),
  fault: null,
  statusUnavailableReason: null,
  ...overrides,
});

test("joins session sources across workspaces and changes grouping without more reads", async () => {
  const tasksByRepo = new Map([
    ["/alpha", [createTaskCardFixture({ id: "blocked", title: "Resolve CI", status: "blocked" })]],
    [
      "/beta",
      [
        createTaskCardFixture({ id: "build", title: "Keep background", status: "in_progress" }),
        createTaskCardFixture({ id: "closed", title: "Removed worktree", status: "closed" }),
      ],
    ],
  ]);
  const sessionsByTask = new Map([
    [
      "blocked",
      [
        {
          ...record("older", "/alpha", "2026-09-28T08:00:00.000Z"),
          lastActivityAt: Date.parse("2026-09-30T09:00:00.000Z"),
        },
        {
          ...record("latest", "/alpha", "2026-09-29T08:00:00.000Z"),
          lastActivityAt: Date.parse("2026-09-30T09:00:00.000Z"),
        },
      ],
    ],
    ["build", [record("beta-build", "/beta", "2026-09-30T06:00:00.000Z")]],
  ]);
  const readHistory = mock(async () => []);
  const readSessions = mock(async (_repoPath: string, taskIds: string[]) => {
    if (taskIds.includes("closed")) throw new Error("The closed task's worktree was removed.");
    return taskIds.map((taskId) => ({ taskId, agentSessions: sessionsByTask.get(taskId) ?? [] }));
  });
  const connection = createTestClientConnection({
    client: {
      tasksList: async (repoPath) => tasksByRepo.get(repoPath) ?? [],
      agentSessionsListForTasks: readSessions,
      workspaceSessionListActive: async (workspaceId) =>
        workspaceId === "alpha"
          ? [chat("running", "/alpha", Date.parse("2026-09-30T07:00:00.000Z"))]
          : [chat("quiet", "/beta", Date.parse("2026-09-30T10:00:00.000Z"))],
      agentRuntimeLoadSessionHistory: readHistory,
    },
  });
  const alphaKey = (externalSessionId: string) =>
    agentSessionIdentityKey({
      externalSessionId,
      runtimeKind: "codex",
      workingDirectory: "/alpha",
    });
  const observer = createWorkspaceActivityObserverStub(
    {},
    {
      alpha: {
        kind: "ready",
        sessions: new Map([
          [alphaKey("latest"), facts({ activityState: "waiting_input", pendingQuestion: true })],
          [alphaKey("native-running"), facts({ activityState: "running" })],
        ]),
        faults: new Map(),
      },
      beta: { kind: "ready", sessions: new Map(), faults: new Map() },
    },
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceActivityContext.Provider value={observer}>
        {children}
      </WorkspaceActivityContext.Provider>
    </ClientConnectionProvider>
  );
  const workspaces = [alpha, beta];

  const { result, rerender } = renderHook(
    (grouping: SidebarSessionGrouping) => useSessionNavigationModel(workspaces, grouping).model,
    { initialProps: "none", wrapper },
  );

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
    expect(result.current.entryCount).toBe(5);
    expect(result.current.issues).toEqual([]);
    const recent = result.current.groups[2]?.entries ?? [];
    expect(recent.map((entry) => entry.time.kind)).toEqual(["activity", "activity", "started"]);
  });
  const [needsYou, running, recent] = result.current.groups;
  expect(needsYou?.entries.map((entry) => [entry.title, entry.attention])).toEqual([
    ["Resolve CI", ["question"]],
  ]);
  expect(running?.entries.map((entry) => entry.title)).toEqual(["Chat running"]);
  expect(recent?.entries.map((entry) => entry.title)).toEqual([
    "Chat quiet",
    "Resolve CI",
    "Keep background",
  ]);
  expect(recent?.entries[2]?.time).toEqual({
    kind: "started",
    at: Date.parse("2026-09-30T06:00:00.000Z"),
  });
  expect(readHistory).not.toHaveBeenCalled();
  expect(readSessions.mock.calls.flatMap(([, taskIds]) => taskIds)).not.toContain("closed");
  const sessionReads = readSessions.mock.calls.length;
  rerender("task");
  expect(result.current.entryCount).toBe(4);
  expect(result.current.groups[2]?.entries.map((entry) => entry.title)).toEqual([
    "Chat quiet",
    "Keep background",
  ]);
  rerender("none");
  expect(result.current.entryCount).toBe(5);
  expect(readSessions).toHaveBeenCalledTimes(sessionReads);
  expect(readHistory).not.toHaveBeenCalled();
});

test("reports a failed batch session read and reads it again on retry", async () => {
  let batchReads = 0;
  const connection = createTestClientConnection({
    client: {
      tasksList: async () => [createTaskCardFixture({ id: "task-1", title: "Retry me" })],
      agentSessionsListForTasks: async (_repoPath, taskIds) => {
        batchReads += 1;
        if (batchReads === 1) throw new Error("Session records are locked.");
        return taskIds.map((taskId) => ({
          taskId,
          agentSessions: [record("native", "/alpha", "2026-09-30T06:00:00.000Z")],
        }));
      },
      workspaceSessionListActive: async () => [],
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </ClientConnectionProvider>
  );
  const workspaces = [alpha];
  const { result } = renderHook(() => useSessionNavigationModel(workspaces, "none"), { wrapper });

  await waitFor(() =>
    expect(result.current.model.issues).toEqual([
      { workspace: alpha, source: "task_sessions", message: "Session records are locked." },
    ]),
  );
  expect(result.current.model.entryCount).toBe(0);

  const [issue] = result.current.model.issues;
  if (!issue) throw new Error("Expected a task session issue.");
  result.current.retrySource(issue);

  await waitFor(() => expect(result.current.model.entryCount).toBe(1));
  expect(result.current.model.issues).toEqual([]);
  expect(batchReads).toBe(2);
});

test("reads the tasks, chats, and task sessions of the refreshed workspaces again", async () => {
  const reads: string[] = [];
  const connection = createTestClientConnection({
    client: {
      tasksList: async (repoPath) => {
        reads.push(`tasks ${repoPath}`);
        return [createTaskCardFixture({ id: `task${repoPath.replace("/", "-")}`, title: "Task" })];
      },
      agentSessionsListForTasks: async (repoPath, taskIds) => {
        reads.push(`task sessions ${repoPath}`);
        return taskIds.map((taskId) => ({ taskId, agentSessions: [] }));
      },
      workspaceSessionListActive: async (workspaceId) => {
        reads.push(`chats ${workspaceId}`);
        return [];
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </ClientConnectionProvider>
  );
  const workspaces = [alpha, beta];
  const { result } = renderHook(() => useSessionNavigationModel(workspaces, "none"), { wrapper });
  await waitFor(() =>
    expect(reads.toSorted()).toEqual([
      "chats alpha",
      "chats beta",
      "task sessions /alpha",
      "task sessions /beta",
      "tasks /alpha",
      "tasks /beta",
    ]),
  );

  reads.length = 0;
  await act(() => result.current.refresh("beta"));
  expect(reads.toSorted()).toEqual(["chats beta", "task sessions /beta", "tasks /beta"]);

  reads.length = 0;
  await act(() => result.current.refresh(null));
  expect(reads.toSorted()).toEqual([
    "chats alpha",
    "chats beta",
    "task sessions /alpha",
    "task sessions /beta",
    "tasks /alpha",
    "tasks /beta",
  ]);
});

test("keeps cached task sessions listed while the batch read of a new task fails", async () => {
  const connection = createTestClientConnection({
    client: {
      tasksList: async () => [
        createTaskCardFixture({ id: "cached", title: "Cached task" }),
        createTaskCardFixture({ id: "new", title: "New task" }),
      ],
      agentSessionsListForTasks: async () => {
        throw new Error("Session records are locked.");
      },
      workspaceSessionListActive: async () => [],
    },
  });
  const { queryClient } = connection;
  queryClient.setQueryData(agentSessionQueryKeys.list("/alpha", "cached"), [
    record("native", "/alpha", "2026-09-30T06:00:00.000Z"),
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </ClientConnectionProvider>
  );
  const workspaces = [alpha];

  const { result } = renderHook(() => useSessionNavigationModel(workspaces, "none").model, {
    wrapper,
  });

  await waitFor(() =>
    expect(result.current.issues).toEqual([
      { workspace: alpha, source: "task_sessions", message: "Session records are locked." },
    ]),
  );
  expect(
    result.current.groups.flatMap((group) => group.entries.map((entry) => entry.title)),
  ).toEqual(["Cached task"]);
});

test("keeps every unchanged entry and the model of an equal rebuild", async () => {
  const chats = [
    chat("first", "/alpha", Date.parse("2026-09-30T07:00:00.000Z")),
    chat("second", "/alpha", Date.parse("2026-09-30T08:00:00.000Z")),
  ];
  const connection = createTestClientConnection({
    client: {
      tasksList: async () => [createTaskCardFixture({ id: "build", title: "Build it" })],
      agentSessionsListForTasks: async (_repoPath: string, taskIds: string[]) =>
        taskIds.map((taskId) => ({
          taskId,
          agentSessions: [record("task-native", "/alpha", "2026-09-30T06:00:00.000Z")],
        })),
      workspaceSessionListActive: async () => chats,
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </ClientConnectionProvider>
  );
  const { result, rerender } = renderHook(
    (workspaces: SessionNavigationWorkspace[]) =>
      useSessionNavigationModel(workspaces, "none").model,
    { initialProps: [alpha], wrapper },
  );
  await waitFor(() => expect(result.current.entryCount).toBe(3));
  const before = result.current;
  const titlesOf = (model: typeof before) =>
    model.groups.flatMap((group) => group.entries.map((entry) => entry.title));
  expect(titlesOf(before)).toEqual(["Chat second", "Chat first", "Build it"]);

  rerender([{ ...alpha }]);
  expect(result.current).toBe(before);

  act(() => {
    connection.queryClient.setQueryData(workspaceSessionQueryKeys.list("alpha", false), [
      { ...chats[0], manualTitle: "Renamed" },
      chats[1],
    ]);
  });
  await waitFor(() =>
    expect(titlesOf(result.current)).toEqual(["Chat second", "Renamed", "Build it"]),
  );
  const after = result.current;
  const [kept, renamed, task] = after.groups[2]?.entries ?? [];
  const [keptBefore, renamedBefore, taskBefore] = before.groups[2]?.entries ?? [];
  expect(kept).toBe(keptBefore);
  expect(task).toBe(taskBefore);
  expect(renamed).not.toBe(renamedBefore);
  expect(after.groups[0]).toBe(before.groups[0]);
  expect(after.taskBlocks).toBe(before.taskBlocks);
});
