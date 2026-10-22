import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  AgentWorkflowSessionForkResult,
  WorkspaceSession,
  WorkspaceSessionForkResult,
} from "@openducktor/contracts";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { agentSessionQueryKeys } from "../queries/agent-sessions";
import { workspaceSessionQueryKeys } from "../queries/workspace-sessions";
import { createAgentSessionsStore } from "./agent-sessions-store";
import { fromPersistedSessionRecord } from "./agent-orchestrator/support/persistence";
import { createSessionMessagesState } from "./agent-orchestrator/support/messages";
import { forkTaskSession, forkWorkspaceSession } from "./session-forks";

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
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

describe("session forks", () => {
  test("shares one pending reply request, commits the returned child, and preserves the active source and baseline loading", async () => {
    let calls = 0;
    let resolve!: (value: AgentWorkflowSessionForkResult) => void;
    const connection = createTestClientConnection({
      client: {
        agentSessionWorkflowFork: () => {
          calls += 1;
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
    const first = forkTaskSession(queryClient, store, taskInput());
    const second = forkTaskSession(queryClient, store, taskInput());
    expect(second).toBe(first);
    await Promise.resolve();
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
    const connections = calls.map((_, index) =>
      createTestClientConnection({
        client: {
          agentSessionWorkflowFork: async () => {
            calls[index]! += 1;
            return new Promise<never>(() => {});
          },
        },
      }),
    );
    const store = createAgentSessionsStore("/repo");
    const [first, second] = connections;
    if (!first || !second) throw new Error("Missing host fixtures");
    void forkTaskSession(first.queryClient, store, taskInput());
    void forkTaskSession(first.queryClient, store, { ...taskInput(), workingDirectory: "/other" });
    void forkTaskSession(first.queryClient, store, {
      ...taskInput(),
      forkPoint: { messageId: "earlier" },
    });
    void forkTaskSession(second.queryClient, store, taskInput());
    await Promise.resolve();
    expect(calls).toEqual([3, 1]);
  });

  test("a refused workspace fork saves no record, then permits a retry with the same names", async () => {
    let calls = 0;
    const child = workspaceRecord("child");
    const connection = createTestClientConnection({
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
