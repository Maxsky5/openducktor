import { afterEach, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  SidebarSessionGrouping,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { LoadAgentSessionMetadataInput } from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkspaceSessionLiveFacts } from "@/features/workspace-activity/workspace-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import type { SessionNavigationWorkspace } from "@/state/read-models/session-navigation-read-model";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createTaskCardFixture,
  createWorkspaceActivityObserverStub,
} from "@/test-utils/shared-test-fixtures";
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
  createdAt: updatedAt,
  updatedAt,
  archivedAt: null,
});

const facts = (overrides: Partial<WorkspaceSessionLiveFacts>): WorkspaceSessionLiveFacts => ({
  activityState: "idle",
  pendingQuestion: false,
  pendingPermission: false,
  lastActivityAt: null,
  fault: null,
  statusUnavailableReason: null,
  ...overrides,
});

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
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
        record("older", "/alpha", "2026-09-28T08:00:00.000Z"),
        record("latest", "/alpha", "2026-09-29T08:00:00.000Z"),
      ],
    ],
    ["build", [record("beta-build", "/beta", "2026-09-30T06:00:00.000Z")]],
  ]);
  const readMetadata = mock(async (input: LoadAgentSessionMetadataInput) => {
    if (input.externalSessionId === "beta-build") throw new Error("Codex is not running.");
    return {
      ref: {
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
      },
      lastActivityAt: Date.parse("2026-09-30T09:00:00.000Z"),
    };
  });
  const readSessions = mock(async (_repoPath: string, taskIds: string[]) => {
    if (taskIds.includes("closed")) throw new Error("The closed task's worktree was removed.");
    return taskIds.map((taskId) => ({ taskId, agentSessions: sessionsByTask.get(taskId) ?? [] }));
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        tasksList: async (repoPath) => tasksByRepo.get(repoPath) ?? [],
        agentSessionsListForTasks: readSessions,
        workspaceSessionListActive: async (workspaceId) =>
          workspaceId === "alpha"
            ? [chat("running", "/alpha", Date.parse("2026-09-30T07:00:00.000Z"))]
            : [chat("quiet", "/beta", Date.parse("2026-09-30T10:00:00.000Z"))],
        agentRuntimeLoadSessionMetadata: readMetadata,
      },
    }),
  );
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
    <QueryProvider useIsolatedClient>
      <WorkspaceActivityContext.Provider value={observer}>
        {children}
      </WorkspaceActivityContext.Provider>
    </QueryProvider>
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
    ["Resolve CI", ["question", "blocked"]],
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
    activityTimeIssue: "Codex is not running.",
  });
  expect(readMetadata).toHaveBeenCalledWith({
    repoPath: "/alpha",
    runtimeKind: "codex",
    workingDirectory: "/alpha",
    externalSessionId: "older",
    sessionScope: { kind: "workflow", taskId: "blocked", role: "build" },
  });
  expect(readSessions.mock.calls.flatMap(([, taskIds]) => taskIds)).not.toContain("closed");
  const sessionReads = readSessions.mock.calls.length;
  const metadataReads = readMetadata.mock.calls.length;
  rerender("task");
  expect(result.current.entryCount).toBe(4);
  expect(result.current.groups[2]?.entries.map((entry) => entry.title)).toEqual([
    "Chat quiet",
    "Keep background",
  ]);
  rerender("none");
  expect(result.current.entryCount).toBe(5);
  expect(readSessions).toHaveBeenCalledTimes(sessionReads);
  expect(readMetadata).toHaveBeenCalledTimes(metadataReads);
});

test("reports a failed batch session read and reads it again on retry", async () => {
  let batchReads = 0;
  configureShellBridge(
    createShellBridgeFixture({
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
        agentRuntimeLoadSessionMetadata: async (input) => ({
          ref: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          },
          lastActivityAt: null,
        }),
      },
    }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryProvider useIsolatedClient>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </QueryProvider>
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

test("keeps cached task sessions listed while the batch read of a new task fails", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        tasksList: async () => [
          createTaskCardFixture({ id: "cached", title: "Cached task" }),
          createTaskCardFixture({ id: "new", title: "New task" }),
        ],
        agentSessionsListForTasks: async () => {
          throw new Error("Session records are locked.");
        },
        workspaceSessionListActive: async () => [],
        agentRuntimeLoadSessionMetadata: async (input) => ({
          ref: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          },
          lastActivityAt: null,
        }),
      },
    }),
  );
  const queryClient = createQueryClient();
  queryClient.setQueryData(agentSessionQueryKeys.list("/alpha", "cached"), [
    record("native", "/alpha", "2026-09-30T06:00:00.000Z"),
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceActivityContext.Provider value={createWorkspaceActivityObserverStub()}>
        {children}
      </WorkspaceActivityContext.Provider>
    </QueryClientProvider>
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
