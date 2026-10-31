import { afterEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  AgentSessionLiveEnvelope,
  AgentWorkflowSessionForkResult,
  WorkspaceSession,
  WorkspaceSessionForkResult,
} from "@openducktor/contracts";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import type { StartupProgressListener } from "../connection/host-connection";
import { agentSessionQueryKeys } from "../queries/agent-sessions";
import { workspaceSessionQueryKeys } from "../queries/workspace-sessions";
import { createAgentSessionsStore } from "./agent-sessions-store";
import { fromPersistedSessionRecord } from "./agent-orchestrator/support/persistence";
import { createSessionMessagesState } from "./agent-orchestrator/support/messages";
import { forkTaskSession, forkWorkspaceSession } from "./session-forks";
import { createStartupLiveSourceFake } from "../test-support/startup-live-source-fake";
import { HostInvokeError } from "@openducktor/host-client";
import { createWorkspaceSessionLiveSource } from "../workspace-activity/workspace-session-live-source";
import { createLiveSnapshotEnvelope } from "../test-support/agent-session-live-fixture";
import {
  registerStartupLiveSource,
  retainStartupPreparationWorkspaces,
} from "./startup/startup-prepared-handoff";

const connections: ReturnType<typeof createTestClientConnection>[] = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.dispose()));
});
const createForkConnection = (options: Parameters<typeof createTestClientConnection>[0]) => {
  const connection = createTestClientConnection(options);
  connections.push(connection);
  createStartupLiveSourceFake(connection.queryClient);
  return connection;
};
const taskOptions = { workspaceId: "workspace" };

const sourceRecord = (): AgentSessionRecord => ({
  externalSessionId: "source",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  role: "build",
  startedAt: "2026-10-01T10:00:00.000Z",
  selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
});
const taskInput = () => ({
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "source",
  sessionScope: { kind: "workflow" as const, taskId: "task", role: "build" as const },
  forkPoint: { messageId: "reply" },
});
const taskResult = (): AgentWorkflowSessionForkResult => ({
  record: { ...sourceRecord(), externalSessionId: "child" },
  runtimeSession: {
    externalSessionId: "child",
    runtimeKind: "codex",
    workingDirectory: "/repo",
    status: "idle",
    startedAt: "2026-10-22T10:00:00.000Z",
  },
  syncWarning: "The live stream could not publish. Reconnect to refresh.",
});
const workspaceRecord = (id: string): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: id,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: id,
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

describe("session forks", () => {
  test.each(["handoff", "dismiss", "expiry"] as const)(
    "a late fork response still publishes its child after ready feedback leaves through %s",
    async (release) => {
      let calls = 0;
      let publish: StartupProgressListener | undefined;
      let result: AgentWorkflowSessionForkResult | undefined;
      const response = Promise.withResolvers<AgentWorkflowSessionForkResult>();
      const ready = Promise.withResolvers<void>();
      const connection = createForkConnection({
        host: createTestHostConnection({
          subscribeStartupProgress: async (listener) => {
            publish = listener;
            return () => {};
          },
          client: {
            agentSessionWorkflowFork: async (input) => {
              calls += 1;
              if (!input.startup) throw new Error("Missing startup context");
              const child = taskResult();
              result = {
                ...child,
                startupProgress: live.prepared({
                  context: input.startup,
                  workspaceId: "workspace",
                  repoPath: "/repo",
                  scope: { kind: "task", taskId: "task", role: "build" },
                  ownership: {
                    state: "saved",
                    target: {
                      kind: "task",
                      record: child.record,
                      runtimeSession: child.runtimeSession,
                    },
                  },
                }),
              };
              await publish?.({
                channel: "openducktor://session-startup-progress",
                payload: result.startupProgress!,
              });
              return response.promise;
            },
          },
        }),
      });
      const live = createStartupLiveSourceFake(connection.queryClient);
      const store = createAgentSessionsStore("/repo");
      let id = "";
      const stop = connection.startupAttempts.subscribe(() => {
        if (connection.startupAttempts.getAttempt(id)?.status.phase === "ready") ready.resolve();
      });
      const request = forkTaskSession(connection.queryClient, store, taskInput(), {
        ...taskOptions,
        onAttempt: (attemptId) => {
          id = attemptId;
        },
      });
      await ready.promise;
      expect(connection.startupAttempts.isReadyForHandoff(id)).toBe(false);
      if (release === "expiry")
        connection.startupAttempts.expireSuccess(
          connection.startupAttempts.getAttempt(id)!.status.successExpiresAt!,
        );
      else connection.startupAttempts[release](id);
      expect(connection.startupAttempts.getAttempt(id)).toBeNull();
      if (!result) throw new Error("Missing held fork result");
      response.resolve(result);
      try {
        const returned = await request;
        expect(returned.record.externalSessionId).toBe("child");
        expect(store.getSessionSnapshot(returned.runtimeSession)?.externalSessionId).toBe("child");
        expect(calls).toBe(1);
        expect(connection.startupAttempts.getAttempt(id)).toBeNull();
      } finally {
        stop();
      }
    },
  );

  test("claims one repair while a closed workspace waits to reopen and prepares the saved child", async () => {
    let forkCalls = 0;
    const startIds: string[] = [];
    const child = workspaceRecord("child");
    const runtimeSession = { ...taskResult().runtimeSession, externalSessionId: "child" };
    let emit!: (envelope: AgentSessionLiveEnvelope) => void;
    const connection = createForkConnection({
      client: {
        workspaceSessionFork: async (input) => {
          forkCalls += 1;
          if (!input.startup) throw new Error("Missing startup context");
          throw new HostInvokeError("Native preparation failed", {
            kind: "session_startup",
            startupProgress: {
              context: input.startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: "workspace",
              repoPath: "/repo",
              scope: { kind: "workspace", sessionId: "child" },
              phase: "failed",
              steps: [],
              ownership: { state: "saved", target: { kind: "workspace", record: child } },
            },
          });
        },
        workspaceSessionStart: async (input) => {
          startIds.push(input.sessionId);
          if (!input.startup) throw new Error("Missing repair startup context");
          const ref = {
            repoPath: "/repo",
            runtimeKind: runtimeSession.runtimeKind,
            externalSessionId: runtimeSession.externalSessionId,
            workingDirectory: runtimeSession.workingDirectory,
          };
          emit({
            type: "session_upsert",
            sequence: 2,
            session: {
              ref,
              activity: "idle",
              startedAt: runtimeSession.startedAt,
              title: "Child",
              pendingApprovals: [],
              pendingQuestions: [],
              contextUsage: null,
            },
          });
          return {
            session: child,
            runtimeSession,
            startupProgress: {
              context: input.startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: "workspace",
              repoPath: "/repo",
              scope: { kind: "workspace" as const, sessionId: "child" },
              phase: "completed" as const,
              steps: [],
              ownership: {
                state: "saved" as const,
                target: { kind: "workspace" as const, record: child, runtimeSession },
              },
              prepared: { ref, runtimeId: "runtime", liveStateSequence: 2 },
            },
          };
        },
      },
    });
    const source = createWorkspaceSessionLiveSource(
      async (_input, listener) => {
        emit = listener;
        return () => {};
      },
      async () => createLiveSnapshotEnvelope({ sequence: 1, sessions: [] }),
    );
    registerStartupLiveSource(connection.queryClient, source);
    let close = source.observeWorkspace({ repoPath: "/repo" }, () => {});
    let id = "";
    try {
      await forkWorkspaceSession(
        connection.queryClient,
        createAgentSessionsStore("/repo"),
        "/repo",
        taskInput(),
        {
          workspaceId: "workspace",
          sessionId: "source",
          forkPoint: { messageId: "reply" },
          destination: { kind: "same_folder" },
        },
        {
          onAttempt: (attemptId) => {
            id = attemptId;
          },
        },
      );
    } catch {
      /* The trace retains the saved child and its repair. */
    }
    const attempt = connection.startupAttempts.getAttempt(id);
    expect(attempt?.ownership.state).toBe("saved");
    expect(attempt?.recoveryActions?.map((action) => action.kind)).toEqual(["repair"]);
    close();
    retainStartupPreparationWorkspaces(connection.queryClient, []);
    const repair = attempt!.recoveryActions![0]!.run;
    const first = repair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = repair();
    expect(startIds).toEqual([]);
    const pending = connection.startupAttempts.getAttempt(id);
    close = source.observeWorkspace({ repoPath: "/repo" }, () => {});
    await Promise.all([first, second]);
    close();
    expect(forkCalls).toBe(1);
    expect(startIds).toEqual(["child"]);
    expect(pending?.status.phase).toBe("submitting");
    expect(pending?.recoveryActions).toBeUndefined();
    expect(connection.startupAttempts.getAttempt(id)?.status.phase).toBe("ready");
    expect(
      connection.startupAttempts.getAttempt(id)?.operations.map((operation) => operation.phase),
    ).toEqual(["failed", "completed"]);
  });

  test("shares one pending reply request, commits the returned child, and preserves the active source and baseline loading", async () => {
    let calls = 0;
    const dispatched = Promise.withResolvers<void>();
    let resolve!: (value: AgentWorkflowSessionForkResult) => void;
    const connection = createForkConnection({
      client: {
        agentSessionWorkflowFork: () => {
          calls += 1;
          dispatched.resolve();
          return new Promise((done) => {
            resolve = done;
          });
        },
      },
    });
    const queryClient = connection.queryClient;
    const store = createAgentSessionsStore("/repo");
    const source = {
      ...fromPersistedSessionRecord({ taskId: "task", record: sourceRecord() }),
      status: "running" as const,
      pendingApprovals: [
        {
          requestId: "approval",
          requestType: "command_execution" as const,
          title: "Approve command",
        },
      ],
      messages: createSessionMessagesState("source", [
        { id: "later", role: "user", content: "Later work", timestamp: "2026-10-22T10:00:00.000Z" },
      ]),
    };
    store.replaceSession(source);
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task"), [sourceRecord()]);
    const first = forkTaskSession(queryClient, store, taskInput(), taskOptions);
    const second = forkTaskSession(queryClient, store, taskInput(), taskOptions);
    expect(second).toBe(first);
    await dispatched.promise;
    expect(calls).toBe(1);
    resolve(taskResult());
    const result = await first;
    expect(result.syncWarning).toContain("Reconnect");
    expect(store.getSessionSnapshot(source)).toBe(source);
    const child = store.getSessionSnapshot(result.runtimeSession);
    expect(child?.historyLoadState).toBe("not_requested");
    expect(child?.messages.items).toEqual([]);
    expect(child?.pendingApprovals).toEqual([]);
    expect(child?.pendingQuestions).toEqual([]);
    expect(child?.status).toBe("idle");
    expect(
      queryClient
        .getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "task"))
        ?.map((record) => record.externalSessionId),
    ).toEqual(["source", "child"]);
  });

  test("scopes pending requests to the host and full source identity", async () => {
    const calls = [0, 0];
    const dispatched = Promise.withResolvers<void>();
    const connections = calls.map((_, index) =>
      createForkConnection({
        client: {
          agentSessionWorkflowFork: async () => {
            calls[index]! += 1;
            if (calls[0] === 3 && calls[1] === 1) dispatched.resolve();
            return new Promise<never>(() => {});
          },
        },
      }),
    );
    const store = createAgentSessionsStore("/repo");
    const [first, second] = connections;
    if (!first || !second) throw new Error("Missing host fixtures");
    void forkTaskSession(first.queryClient, store, taskInput(), taskOptions);
    void forkTaskSession(
      first.queryClient,
      store,
      { ...taskInput(), workingDirectory: "/other" },
      taskOptions,
    );
    void forkTaskSession(
      first.queryClient,
      store,
      {
        ...taskInput(),
        forkPoint: { messageId: "earlier" },
      },
      taskOptions,
    );
    void forkTaskSession(second.queryClient, store, taskInput(), taskOptions);
    await dispatched.promise;
    expect(calls).toEqual([3, 1]);
  });

  test("a refused workspace fork saves no record, then permits a retry with the same names", async () => {
    let calls = 0;
    const child = workspaceRecord("child");
    const connection = createForkConnection({
      client: {
        workspaceSessionFork: async () => {
          calls += 1;
          if (calls === 1) throw new Error("The native fork point expired. Reload history.");
          return { record: child, runtimeSession: taskResult().runtimeSession };
        },
      },
    });
    const store = createAgentSessionsStore("/repo");
    const queryClient = connection.queryClient;
    const source = workspaceRecord("source");
    const key = workspaceSessionQueryKeys.list("workspace", false);
    queryClient.setQueryData(key, [source]);
    const input = {
      workspaceId: "workspace",
      sessionId: "source",
      forkPoint: { messageId: "reply" },
      destination: { kind: "new_worktree" as const, name: "retry", branchName: "odt/retry" },
    };
    try {
      await forkWorkspaceSession(queryClient, store, "/repo", taskInput(), input);
      throw new Error("The first fork must fail");
    } catch (cause) {
      expect(String(cause)).toContain("Reload history");
    }
    expect(queryClient.getQueryData(key)).toEqual([source]);
    expect(store.listSessionSnapshots()).toEqual([]);
    const result: WorkspaceSessionForkResult = await forkWorkspaceSession(
      queryClient,
      store,
      "/repo",
      taskInput(),
      input,
    );
    expect(calls).toBe(2);
    expect(queryClient.getQueryData<WorkspaceSession[]>(key)?.map((record) => record.id)).toEqual([
      "source",
      "child",
    ]);
    expect(store.getSessionSnapshot(result.runtimeSession)?.historyLoadState).toBe("not_requested");
  });
});
