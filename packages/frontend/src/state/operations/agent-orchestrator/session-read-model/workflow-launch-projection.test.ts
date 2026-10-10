import { expect, test } from "bun:test";
import type { AgentSessionRecord, WorkflowLaunchResult } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { projectWorkflowLaunch } from "./workflow-launch-projection";

const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "model" };
const outcome: WorkflowLaunchResult = {
  workspaceId: "workspace",
  repoPath: "/repo",
  taskId: "task",
  role: "build",
  status: "completed",
  startMode: "fresh",
  model,
  session: {
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/worktree",
    startedAt: "2026-10-04T00:00:00.000Z",
    status: "idle",
  },
};

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

test("a failed launch registers its saved session without claiming live presence", () => {
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient();
  projectWorkflowLaunch(store, queryClient, {
    ...outcome,
    status: "failed",
    failure: { message: "Kickoff failed", cleanupErrors: [] },
  });
  const session = store.getSessionSnapshot(outcome.session!);
  expect(session).toMatchObject({
    sessionAssociation: { kind: "workflow", taskId: "task", role: "build" },
    historyLoadState: "not_requested",
  });
  expect(session?.livePresence).not.toBe("present");
  queryClient.clear();
});

test("a launch without a saved session changes nothing", () => {
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient();
  const key = agentSessionQueryKeys.list("/repo", "task");
  queryClient.setQueryData(key, []);
  const { session: _session, ...withoutSession } = outcome;
  projectWorkflowLaunch(store, queryClient, {
    ...withoutSession,
    status: "failed",
    failure: { message: "Runtime is offline", cleanupErrors: [] },
  });
  expect(store.listSessionSnapshots()).toEqual([]);
  expect(queryClient.getQueryData<AgentSessionRecord[]>(key)).toEqual([]);
  queryClient.clear();
});
