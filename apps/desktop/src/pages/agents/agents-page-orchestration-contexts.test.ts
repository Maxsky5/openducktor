import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import { buildAgentsPageOrchestrationContexts } from "./agents-page-orchestration-contexts";

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const session = createAgentSessionFixture({
  runtimeKind: "opencode",
  sessionId: "session-1",
  taskId: "task-1",
  role: "planner",
  scenario: "planner_initial",
});

describe("buildAgentsPageOrchestrationContexts", () => {
  test("builds grouped orchestration inputs with optional session-start action", () => {
    const requestNewSessionStart = async () => ({ selectedModel: null });
    const updateQuery = () => undefined;
    const contexts = buildAgentsPageOrchestrationContexts({
      activeRepo: "/repo",
      selection: {
        viewTaskId: "task-1",
        viewRole: "planner",
        viewScenario: "planner_initial",
        viewSelectedTask: task,
        viewSessionsForTask: [session],
        viewActiveSession: session,
        activeTaskTabId: "task-1",
        taskTabs: [],
        availableTabTasks: [task],
        contextSwitchVersion: 2,
        isLoadingTasks: false,
        isActiveTaskHydrated: true,
        isActiveTaskHydrationFailed: false,
        isViewSessionHistoryHydrationFailed: false,
        isViewSessionHistoryHydrating: false,
        onCreateTab: () => undefined,
        onCloseTab: () => undefined,
      },
      readiness: {
        agentStudioReady: true,
        agentStudioBlockedReason: null,
        isLoadingChecks: false,
        refreshChecks: async () => undefined,
      },
      composer: {
        input: "hello",
        setInput: () => undefined,
      },
      actions: {
        updateQuery,
        onContextSwitchIntent: () => undefined,
        startAgentSession: async () => "session-1",
        sendAgentMessage: async () => undefined,
        stopAgentSession: async () => undefined,
        updateAgentSessionModel: async () => undefined,
        loadAgentSessions: async () => undefined,
        humanRequestChangesTask: async () => undefined,
        replyAgentPermission: async () => undefined,
        answerAgentQuestion: async () => undefined,
        requestNewSessionStart,
        openTaskDetails: () => undefined,
      },
    });

    expect(contexts.workspace.activeRepo).toBe("/repo");
    expect(contexts.selection.viewActiveSession?.sessionId).toBe("session-1");
    expect(contexts.readiness.agentStudioReady).toBe(true);
    expect(contexts.composer.input).toBe("hello");
    expect(contexts.actions.updateQuery).toBe(updateQuery);
    expect(contexts.actions.requestNewSessionStart).toBe(requestNewSessionStart);
  });
});
