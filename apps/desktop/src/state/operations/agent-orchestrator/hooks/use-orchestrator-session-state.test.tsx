import { describe, expect, test } from "bun:test";
import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
};

const runFixture: RunSummary = {
  runId: "run-1",
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  repoPath: "/tmp/repo-a",
  taskId: "task-1",
  branch: "obp/task-1",
  worktreePath: "/tmp/repo-a/worktree",
  port: 4444,
  state: "running",
  lastMessage: null,
  startedAt: "2026-03-01T09:00:00.000Z",
};

const createSessionFixture = (): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeId: "runtime-1",
  runId: "run-1",
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo-a",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

type HookArgs = Parameters<typeof useOrchestratorSessionState>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useOrchestratorSessionState> | null = null;
  let currentArgs = initialArgs;

  const Harness = () => {
    latest = useOrchestratorSessionState(currentArgs);
    return null;
  };

  const sharedHarness = createSharedHookHarness(Harness, undefined);

  const mount = async () => {
    await sharedHarness.mount();
  };

  const unmount = async () => {
    await sharedHarness.unmount();
  };

  const update = async (nextArgs: HookArgs) => {
    currentArgs = nextArgs;
    await sharedHarness.update(undefined);
  };

  const run = async (callback: (hook: ReturnType<typeof useOrchestratorSessionState>) => void) => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    await sharedHarness.run(() => {
      callback(latest as ReturnType<typeof useOrchestratorSessionState>);
    });
  };

  const getLatest = () => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  return {
    mount,
    unmount,
    update,
    run,
    getLatest,
  };
};

describe("agent-orchestrator/hooks/use-orchestrator-session-state", () => {
  test("clears sessions and drains all unsubscribers on repo change", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixture],
      runs: [runFixture],
    });
    const unsubscribeCalls: string[] = [];

    try {
      await harness.mount();
      await harness.run((hook) => {
        hook.commitSessions({
          "session-1": createSessionFixture(),
        });

        const unsubscribers = hook.refBridges.unsubscribersRef.current;
        unsubscribers.set("first", () => {
          unsubscribeCalls.push("first");
          unsubscribers.delete("second");
        });
        unsubscribers.set("second", () => {
          unsubscribeCalls.push("second");
        });
      });

      await harness.update({
        activeRepo: "/tmp/repo-b",
        tasks: [taskFixture],
        runs: [runFixture],
      });

      expect(unsubscribeCalls).toEqual(["first", "second"]);
      expect(harness.getLatest().sessionsById).toEqual({});
      expect(harness.getLatest().refBridges.unsubscribersRef.current.size).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps task and run refs synchronized with latest hook inputs", async () => {
    const nextTask: TaskCard = {
      ...taskFixture,
      id: "task-2",
      title: "Task 2",
    };
    const nextRun: RunSummary = {
      ...runFixture,
      runId: "run-2",
      taskId: "task-2",
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixture],
      runs: [runFixture],
    });

    try {
      await harness.mount();

      expect(harness.getLatest().refBridges.taskRef.current).toEqual([taskFixture]);
      expect(harness.getLatest().refBridges.runsRef.current).toEqual([runFixture]);

      await harness.update({
        activeRepo: "/tmp/repo-a",
        tasks: [nextTask],
        runs: [nextRun],
      });

      expect(harness.getLatest().refBridges.taskRef.current).toEqual([nextTask]);
      expect(harness.getLatest().refBridges.runsRef.current).toEqual([nextRun]);
    } finally {
      await harness.unmount();
    }
  });
});
