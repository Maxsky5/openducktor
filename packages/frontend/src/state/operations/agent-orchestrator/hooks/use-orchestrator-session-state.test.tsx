import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { createAgentSessionCollection, listAgentSessions } from "@/state/agent-session-collection";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
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

const createSessionFixture = (): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo-a",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState("external-1"),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
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
  test("clears sessions on repo change", async () => {
    const harness = createHookHarness({
      workspaceRepoPath: "/tmp/repo-a",
      tasks: [taskFixture],
    });
    const session = createSessionFixture();
    try {
      await harness.mount();
      await harness.run((hook) => {
        hook.sessionStore.setSessionCollection(() => createAgentSessionCollection([session]));
      });

      await harness.update({
        workspaceRepoPath: "/tmp/repo-b",
        tasks: [taskFixture],
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot(session)).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps task refs synchronized with latest hook inputs", async () => {
    const nextTask: TaskCard = {
      ...taskFixture,
      id: "task-2",
      title: "Task 2",
    };

    const harness = createHookHarness({
      workspaceRepoPath: "/tmp/repo-a",
      tasks: [taskFixture],
    });

    try {
      await harness.mount();

      expect(harness.getLatest().taskRef.current).toEqual([taskFixture]);
      await harness.update({
        workspaceRepoPath: "/tmp/repo-a",
        tasks: [nextTask],
      });

      expect(harness.getLatest().taskRef.current).toEqual([nextTask]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps session state owned by the session store", async () => {
    const session = createSessionFixture();
    const harness = createHookHarness({
      workspaceRepoPath: "/tmp/repo-a",
      tasks: [taskFixture],
    });

    try {
      await harness.mount();

      await harness.run((hook) => {
        hook.sessionStore.setSessionCollection(() => createAgentSessionCollection([session]));
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot(session)).toEqual(session);

      await harness.run((hook) => {
        hook.sessionStore.setSessionCollection((current) => {
          expect(listAgentSessions(current)).toEqual([session]);
          return createAgentSessionCollection([]);
        });
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot(session)).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("clears assistant turn timing on workspace change", async () => {
    const harness = createHookHarness({
      workspaceRepoPath: "/tmp/repo-a",
      tasks: [taskFixture],
    });

    try {
      await harness.mount();

      await harness.run((hook) => {
        hook.sessionTurnState.timing.recordTurnUserMessageTimestamp("session-1", 111);
      });

      expect(
        harness.getLatest().sessionTurnState.timing.readTurnUserMessageStartedAtMs("session-1"),
      ).toBe(111);

      await harness.update({
        workspaceRepoPath: "/tmp/repo-b",
        tasks: [taskFixture],
      });

      expect(
        harness.getLatest().sessionTurnState.timing.readTurnUserMessageStartedAtMs("session-1"),
      ).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });
});
