import { expect, test } from "bun:test";
import type { AgentSessionRecord, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { projectWorkflowLaunch } from "./workflow-launch-projection";

const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "model" };
const outcome: WorkflowLaunchSnapshot = {
  launchAttemptId: "attempt",
  workspaceId: "workspace",
  repoPath: "/repo",
  taskId: "task",
  role: "build",
  phase: "completed",
  acceptance: "not_submitted",
  ownershipSaved: true,
  completedPreStartActions: [],
  model,
  session: {
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/worktree",
    startedAt: "2026-10-04T00:00:00.000Z",
    status: "idle",
  },
};

test.each(["codex", "opencode", "claude"] as const)(
  "publishes %s ownership and running activity in one store change",
  (runtimeKind) => {
    const store = createAgentSessionsStore("/repo");
    const queryClient = new QueryClient();
    const statuses: string[] = [];
    store.subscribe(() => {
      const session = store.getSessionSnapshot({ ...outcome.session!, runtimeKind });
      if (session) statuses.push(session.status);
    });
    projectWorkflowLaunch(store, queryClient, {
      ...outcome,
      session: { ...outcome.session!, runtimeKind },
      model: { ...model, runtimeKind },
      liveSession: {
        ref: { repoPath: "/repo", ...outcome.session!, runtimeKind },
        activity: "running",
        title: "Native session",
        startedAt: outcome.session!.startedAt,
        contextUsage: null,
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });
    expect(statuses).toEqual(["running"]);
    queryClient.clear();
  },
);

test("registers saved preparation ownership before live delivery without reading history", () => {
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient();
  const key = agentSessionQueryKeys.list("/repo", "task");
  queryClient.setQueryData(key, []);
  projectWorkflowLaunch(store, queryClient, outcome);
  expect(store.getSessionSnapshot(outcome.session!)).toMatchObject({
    sessionAssociation: { kind: "workflow", taskId: "task", role: "build" },
    livePresence: "present",
    status: "idle",
    selectedModel: model,
    historyLoadState: "not_requested",
  });
  expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([
    expect.objectContaining({ externalSessionId: "saved", role: "build" }),
  ]);
  queryClient.clear();
});

test.each(["both", "store", "cache"] as const)(
  "a late launch response preserves the model already bound in the %s",
  (binding) => {
    const store = createAgentSessionsStore("/repo");
    const queryClient = new QueryClient();
    const key = agentSessionQueryKeys.list("/repo", "task");
    const selectedModel = { ...model, modelId: "new-model" };
    const record: AgentSessionRecord = {
      ...outcome.session!,
      role: outcome.role,
      selectedModel,
    };
    if (binding !== "cache") {
      projectWorkflowLaunch(store, queryClient, outcome);
      store.updateSession(outcome.session!, (session) => ({ ...session, selectedModel }));
    }
    queryClient.setQueryData(key, binding === "store" ? [] : [record]);

    projectWorkflowLaunch(store, queryClient, outcome);

    expect(store.getSessionSnapshot(outcome.session!)?.selectedModel).toEqual(selectedModel);
    expect(queryClient.getQueryData<AgentSessionRecord[]>(key)?.[0]?.selectedModel).toEqual(
      selectedModel,
    );
    queryClient.clear();
  },
);

test("preparation presentation preserves newer activity and cannot populate a different workspace view", () => {
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient();
  projectWorkflowLaunch(store, queryClient, outcome);
  store.updateSession(outcome.session!, (session) => ({
    ...session,
    status: "running",
    pendingQuestions: [{ requestId: "new-question", questions: [] }],
  }));
  projectWorkflowLaunch(store, queryClient, outcome);
  expect(store.getSessionSnapshot(outcome.session!)?.pendingQuestions).toHaveLength(1);
  expect(store.getSessionSnapshot(outcome.session!)?.status).toBe("running");
  store.resetWorkspace("/other");
  projectWorkflowLaunch(store, queryClient, outcome);
  expect(store.listSessionSnapshots()).toEqual([]);
  queryClient.clear();
});

test("a completed launch presents native pending input before ownership events arrive", () => {
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient();
  const snapshot: WorkflowLaunchSnapshot = {
    ...outcome,
    acceptance: "accepted",
    liveSession: {
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/worktree",
        externalSessionId: "saved",
      },
      activity: "waiting_for_question",
      title: "Native session",
      startedAt: outcome.session!.startedAt,
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [{ requestId: "native-question", questions: [] }],
    },
  };
  projectWorkflowLaunch(store, queryClient, snapshot);
  expect(store.getSessionSnapshot(outcome.session!)).toMatchObject({
    livePresence: "present",
    status: "idle",
    pendingQuestions: [{ requestId: "native-question" }],
    historyLoadState: "not_requested",
  });
  store.updateSession(outcome.session!, (session) => ({
    ...session,
    status: "idle",
    pendingQuestions: [],
  }));
  projectWorkflowLaunch(store, queryClient, snapshot);
  expect(store.getSessionSnapshot(outcome.session!)?.pendingQuestions).toEqual([]);
  expect(store.getSessionSnapshot(outcome.session!)?.status).toBe("idle");
  queryClient.clear();
});
