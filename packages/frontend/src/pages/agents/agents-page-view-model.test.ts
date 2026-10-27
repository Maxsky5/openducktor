import { describe, expect, mock, test } from "bun:test";
import { Sparkles } from "lucide-react";
import { toAgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildAgentStudioHeaderModel, buildRoleLabelByRole } from "./agents-page-view-model";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const createTaskCard = (id: string): TaskCard => ({
  id,
  title: `Task ${id}`,
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    build: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

type CreateSessionOverrides = AgentSessionFixtureOverrides;

const createSession = (overrides: CreateSessionOverrides = {}): AgentSessionState => {
  return createAgentSessionFixture(
    {
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },

      status: "running",
      runtimeStatusMessage: null,
      startedAt: "2026-02-22T12:00:00.000Z",
      workingDirectory: "/repo",
      historyLoadState: overrides.historyLoadState ?? "not_requested",
    },
    overrides,
  );
};

describe("agents-page-view-model", () => {
  test("buildRoleLabelByRole preserves defaults and applies provided labels", () => {
    const labels = buildRoleLabelByRole([
      { role: "spec", label: "Specification", icon: Sparkles },
      { role: "build", label: "Builder", icon: Sparkles },
    ]);

    expect(labels.spec).toBe("Specification");
    expect(labels.build).toBe("Builder");
    expect(labels.planner).toBe("Planner");
    expect(labels.qa).toBe("QA");
  });

  test("buildAgentStudioHeaderModel keeps selector and workflow contracts", () => {
    const onWorkflowStepSelect = mock(() => {});
    const onSessionSelectionChange = mock(() => {});
    const onPrepareMessageFirstSession = mock(() => {});
    const onQuickAction = mock(() => {});
    const activeSession = createSession({
      pendingApprovals: [
        {
          requestId: "req-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
      pendingQuestions: [{ requestId: "q-1", questions: [] }],
      messages: [{ id: "m-1", role: "assistant", content: "ok", timestamp: "now" }],
    });
    const activeSessionSummary = toAgentSessionSummary(activeSession);

    const model = buildAgentStudioHeaderModel({
      selectedTask: createTaskCard("task-1"),
      onOpenTaskDetails: mock(() => {}),
      roleOptions: [
        { role: "qa", label: "Review option", icon: Sparkles },
        { role: "build", label: "Implementation option", icon: Sparkles },
        { role: "planner", label: "Plan option", icon: Sparkles },
        { role: "spec", label: "Specification option", icon: Sparkles },
      ],
      workflowStateByRole: {
        spec: {
          tone: "in_progress",
          availability: "available",
          completion: "in_progress",
          liveSession: "waiting_input",
        },
        planner: {
          tone: "available",
          availability: "available",
          completion: "not_started",
          liveSession: "none",
        },
        build: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        qa: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
      },
      selectedRole: "spec",
      workflowSessionByRole: {
        spec: activeSessionSummary,
        planner: null,
        build: null,
        qa: null,
      },
      onWorkflowStepSelect,
      onSessionSelectionChange,
      sessionSelectorAutofocusByValue: {
        [activeSession.externalSessionId]: false,
      },
      sessionSelectorValue: activeSession.externalSessionId,
      sessionSelectorGroups: [
        {
          label: "Recent",
          options: [{ value: activeSession.externalSessionId, label: "Spec session" }],
        },
      ],
      agentStudioReady: false,
      sessionsForTaskLength: 0,
      sessionCreateOptions: [],
      onPrepareMessageFirstSession,
      quickActions: [],
      primaryQuickAction: null,
      onQuickAction,
      isStarting: true,
    });

    expect(model.workflowSteps.map(({ id, label, role }) => ({ id, label, role }))).toEqual([
      { id: "specification", label: "Spec", role: "spec" },
      { id: "planning", label: "Planner", role: "planner" },
      { id: "implementation", label: "Builder", role: "build" },
      { id: "quality-review", label: "QA", role: "qa" },
    ]);
    expect(model.workflowSteps[0]?.sessionValue).toContain(activeSession.externalSessionId);
    expect(model.workflowSteps[0]?.hint).toBe("Session is waiting for input");
    expect(model.workflowSteps[0]?.attentionVariant).toBe("session_waiting_input");
    expect(model.onOpenTaskDetails).toBeInstanceOf(Function);
    expect(model.sessionSelector.disabled).toBe(true);
    expect(
      model.sessionSelector.shouldAutofocusComposerForValue(activeSession.externalSessionId),
    ).toBe(false);

    model.sessionSelector.onValueChange("session-next");
    expect(onSessionSelectionChange).toHaveBeenCalledWith("session-next");
  });

  test("buildAgentStudioHeaderModel clears task details action when no task is selected", () => {
    const model = buildAgentStudioHeaderModel({
      selectedTask: null,
      onOpenTaskDetails: mock(() => {}),
      roleOptions: [],
      workflowStateByRole: {
        spec: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        planner: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        build: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        qa: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
      },
      selectedRole: null,
      workflowSessionByRole: {
        spec: null,
        planner: null,
        build: null,
        qa: null,
      },
      onWorkflowStepSelect: mock(() => {}),
      onSessionSelectionChange: mock(() => {}),
      sessionSelectorAutofocusByValue: {},
      sessionSelectorValue: "",
      sessionSelectorGroups: [],
      agentStudioReady: true,
      sessionsForTaskLength: 0,
      sessionCreateOptions: [],
      onPrepareMessageFirstSession: mock(() => {}),
      quickActions: [],
      primaryQuickAction: null,
      onQuickAction: mock(() => {}),
      isStarting: false,
    });

    expect(model.onOpenTaskDetails).toBeNull();
  });
});
