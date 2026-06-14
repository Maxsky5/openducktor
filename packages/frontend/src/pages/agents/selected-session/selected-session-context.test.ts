import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createSelectedSessionLifecycleFixture,
  createTaskCardFixture,
} from "../agent-studio-test-utils";
import {
  type AgentStudioSelectedSessionContextInput,
  buildAgentStudioSelectedSessionContext,
} from "./selected-session-context";

const createDoc = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "spec",
    status: "idle",
    ...overrides,
  });

const createInput = (
  overrides: Partial<AgentStudioSelectedSessionContextInput> = {},
): AgentStudioSelectedSessionContextInput => {
  const selectedTask = createTaskCardFixture({ id: "task-1", title: "Task 1" });
  const sessionsForTask = overrides.sessionsForTask ?? [];

  return {
    taskId: "task-1",
    role: "spec",
    selectedTask,
    sessionsForTask,
    allSessionSummaries: overrides.allSessionSummaries ?? sessionsForTask,
    activeSession: null,
    activeSessionRuntimeData: {
      modelCatalog: null,
      todos: [],
      isLoadingModelCatalog: false,
    },
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    sessionRuntimeDataError: null,
    hasActiveGitConflict: false,
    lifecycle: createSelectedSessionLifecycleFixture(),
    activeSessionContextUsage: null,
    isChatContextSwitching: false,
    documents: {
      specDoc: createDoc("spec"),
      planDoc: createDoc("plan"),
      qaDoc: createDoc("qa"),
    },
    readiness: {
      agentStudioReadinessState: "ready",
      agentStudioReady: true,
      isRuntimeStarting: false,
      agentStudioBlockedReason: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    },
    sessionActions: {
      isStarting: false,
      isSessionWorking: false,
      canKickoffNewSession: true,
      kickoffLabel: "Start Spec",
      startLaunchKickoff: async () => {},
      onSubmitQuestionAnswers: async () => {},
      isSubmittingQuestionByRequestId: {},
    },
    approvals: {
      isSubmittingApprovalByRequestId: {},
      approvalReplyErrorByRequestId: {},
      onReplyApproval: async () => {},
    },
    roleLabelByRole: AGENT_ROLE_LABELS,
    ...overrides,
  };
};

describe("buildAgentStudioSelectedSessionContext", () => {
  test("projects no-task/no-session context without runtime or panel fallbacks", () => {
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        taskId: "",
        selectedTask: null,
        sessionsForTask: [],
        allSessionSummaries: [],
        activeSession: null,
        sessionActions: {
          ...createInput().sessionActions,
          canKickoffNewSession: false,
        },
      }),
    );

    expect(context.documents.activeDocument).toBeNull();
    expect(context.rightPanel.hasTaskContext).toBe(false);
    expect(context.rightPanel.hasDocumentPanel).toBe(false);
    expect(context.chat.emptyState?.title).toBe("Select a task to begin.");
    expect(context.chat.emptyState?.actionLabel).toBeUndefined();
    expect(context.runtime.sessionRuntimeDataError).toBeNull();
  });

  test("maps active document and right-panel availability from selected role semantics", () => {
    const expectedByRole: Record<AgentRole, string | null> = {
      spec: "Specification",
      planner: "Implementation Plan",
      qa: "QA Report",
      build: null,
    };

    for (const [role, expectedTitle] of Object.entries(expectedByRole) as [
      AgentRole,
      string | null,
    ][]) {
      const session = createSession({ role });
      const context = buildAgentStudioSelectedSessionContext(
        createInput({
          role,
          activeSession: session,
          sessionsForTask: [toAgentSessionSummary(session)],
          allSessionSummaries: [toAgentSessionSummary(session)],
        }),
      );

      expect(context.documents.activeDocument?.title ?? null).toBe(expectedTitle);
      expect(context.rightPanel.hasDocumentPanel).toBe(expectedTitle !== null);
      expect(context.rightPanel.hasBuildToolsPanel).toBe(role === "build");
    }
  });

  test("marks unavailable selected role read-only and disables kickoff affordance", () => {
    const unavailablePlannerTask = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        role: "planner",
        selectedTask: unavailablePlannerTask,
      }),
    );

    expect(context.workflow.selectedInteractionRole).toBe("planner");
    expect(context.workflow.selectedRoleAvailable).toBe(false);
    expect(context.chat.composerReadOnly).toBe(true);
    expect(context.chat.composerReadOnlyReason).toContain("Planner is unavailable");
    expect(context.chat.emptyState?.actionLabel).toBeUndefined();
  });

  test("keeps existing session composer writable when selected role is unavailable", () => {
    const unavailableQaTask = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const qaSession = createSession({ role: "qa" });

    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        role: "qa",
        selectedTask: unavailableQaTask,
        activeSession: qaSession,
        sessionsForTask: [toAgentSessionSummary(qaSession)],
        allSessionSummaries: [toAgentSessionSummary(qaSession)],
      }),
    );

    expect(context.workflow.selectedRoleAvailable).toBe(false);
    expect(context.chat.composerReadOnly).toBe(false);
    expect(context.chat.composerReadOnlyReason).toBeNull();
  });

  test("projects kickoff and starting empty-state affordances without stale pending flags", () => {
    const startLaunchKickoff = mock(async () => {});
    const readyContext = buildAgentStudioSelectedSessionContext(
      createInput({
        lifecycle: createSelectedSessionLifecycleFixture({
          phase: "inactive",
        }),
        sessionActions: {
          ...createInput().sessionActions,
          startLaunchKickoff,
        },
      }),
    );

    expect(readyContext.chat.emptyState).toMatchObject({
      title: "Send a message to start a new session automatically.",
      actionLabel: "Start Spec",
    });
    expect(readyContext.chat.emptyState?.isActionPending).toBeUndefined();

    const startingContext = buildAgentStudioSelectedSessionContext(
      createInput({
        lifecycle: createSelectedSessionLifecycleFixture({
          phase: "inactive",
        }),
        sessionActions: {
          ...createInput().sessionActions,
          isStarting: true,
          startLaunchKickoff,
        },
      }),
    );

    expect(startingContext.chat.emptyState).toEqual({ title: "Initializing session..." });
  });

  test("projects runtime readiness and runtime-data errors without masking", () => {
    const refreshChecks = mock(async () => {});
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        sessionRuntimeDataError: "session todos unavailable",
        lifecycle: createSelectedSessionLifecycleFixture({
          phase: "waiting_for_runtime",
        }),
        readiness: {
          agentStudioReadinessState: "blocked",
          agentStudioReady: false,
          isRuntimeStarting: false,
          agentStudioBlockedReason: "Runtime unavailable",
          isLoadingChecks: true,
          refreshChecks,
        },
      }),
    );

    expect(context.runtime.sessionRuntimeDataError).toBe("session todos unavailable");
    expect(context.runtime.lifecycle.isRuntimeWaiting).toBe(true);
    expect(context.runtime.runtimeReadiness).toMatchObject({
      readinessState: "blocked",
      isReady: false,
      blockedReason: "Runtime unavailable",
      isLoadingChecks: true,
    });
    expect(context.runtime.runtimeReadiness.refreshChecks).toBe(refreshChecks);
  });

  test("marks no-session task view as waiting while runtime startup is in progress", () => {
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        activeSession: null,
        sessionsForTask: [],
        allSessionSummaries: [],
        lifecycle: createSelectedSessionLifecycleFixture({
          phase: "resolving_runtime",
        }),
        readiness: {
          agentStudioReadinessState: "checking",
          agentStudioReady: false,
          isRuntimeStarting: true,
          agentStudioBlockedReason: null,
          isLoadingChecks: true,
          refreshChecks: async () => {},
        },
      }),
    );

    expect(context.runtime.lifecycle.isRuntimeWaiting).toBe(true);
    expect(context.chat.emptyState).toBeNull();
  });

  test("does not treat generic readiness checking as runtime startup", () => {
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        activeSession: null,
        sessionsForTask: [],
        allSessionSummaries: [],
        lifecycle: createSelectedSessionLifecycleFixture(),
        readiness: {
          agentStudioReadinessState: "checking",
          agentStudioReady: false,
          isRuntimeStarting: false,
          agentStudioBlockedReason: null,
          isLoadingChecks: true,
          refreshChecks: async () => {},
        },
      }),
    );

    expect(context.runtime.lifecycle.isRuntimeWaiting).toBe(false);
  });

  test("propagates selected-session and subagent pending input affordances", () => {
    const approvalReply = mock(async () => {});
    const questionReply = mock(async () => {});
    const session = createSession({
      externalSessionId: "session-main",
      pendingApprovals: [
        {
          requestId: "approval-main",
          requestType: "runtime_tool",
          title: "Approve tool",
          summary: "Approve a tool call.",
          tool: { name: "shell" },
          mutation: "mutating",
          supportedReplyOutcomes: ["approve_once", "reject"],
        },
      ],
      pendingQuestions: [{ requestId: "question-main", questions: [] }],
    });
    const subagentSession = createSession({
      externalSessionId: "session-sub",
      taskId: "other-task",
      pendingApprovals: [
        {
          requestId: "approval-sub",
          requestType: "runtime_tool",
          title: "Approve subagent tool",
          summary: "Approve a subagent tool call.",
          tool: { name: "shell" },
          mutation: "mutating",
          supportedReplyOutcomes: ["approve_once", "reject"],
        },
      ],
      pendingQuestions: [{ requestId: "question-sub", questions: [] }],
    });

    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        activeSession: session,
        sessionsForTask: [toAgentSessionSummary(session)],
        allSessionSummaries: [
          toAgentSessionSummary(session),
          toAgentSessionSummary(subagentSession),
        ],
        sessionActions: {
          ...createInput().sessionActions,
          onSubmitQuestionAnswers: questionReply,
          isSubmittingQuestionByRequestId: { "question-main": true },
        },
        approvals: {
          isSubmittingApprovalByRequestId: { "approval-main": true },
          approvalReplyErrorByRequestId: { "approval-main": "failed" },
          onReplyApproval: approvalReply,
        },
      }),
    );

    expect(context.pendingInput.pendingQuestions).toMatchObject({
      canSubmit: true,
      isSubmittingByRequestId: { "question-main": true },
    });
    expect(context.pendingInput.pendingQuestions.onSubmit).toBe(questionReply);
    expect(context.pendingInput.approvals).toMatchObject({
      canReply: true,
      isSubmittingByRequestId: { "approval-main": true },
      errorByRequestId: { "approval-main": "failed" },
    });
    expect(context.pendingInput.approvals.onReply).toBe(approvalReply);
    expect(context.pendingInput.subagentPendingApprovalCountByExternalSessionId).toEqual({
      "session-main": 1,
      "session-sub": 1,
    });
    expect(context.pendingInput.subagentPendingQuestionCountByExternalSessionId).toEqual({
      "session-main": 1,
      "session-sub": 1,
    });
  });

  test("disables pending input actions when the selected session has no pending items", () => {
    const noActiveSessionContext = buildAgentStudioSelectedSessionContext(
      createInput({ activeSession: null }),
    );

    expect(noActiveSessionContext.pendingInput.pendingQuestions.canSubmit).toBe(false);
    expect(noActiveSessionContext.pendingInput.approvals.canReply).toBe(false);

    const idleSession = createSession({ pendingApprovals: [], pendingQuestions: [] });
    const idleContext = buildAgentStudioSelectedSessionContext(
      createInput({
        activeSession: idleSession,
        sessionsForTask: [toAgentSessionSummary(idleSession)],
        allSessionSummaries: [toAgentSessionSummary(idleSession)],
      }),
    );

    expect(idleContext.pendingInput.pendingQuestions.canSubmit).toBe(false);
    expect(idleContext.pendingInput.approvals.canReply).toBe(false);
  });
});
