import { describe, expect, mock, test } from "bun:test";
import type { AgentRole } from "@openducktor/core";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createTaskCardFixture,
} from "../agent-studio-test-utils";
import {
  type AgentStudioSelectedSessionContextInput,
  buildAgentStudioSelectedSessionContext,
} from "./selected-session-context";
import type { AgentStudioSelectedSessionState } from "./selected-session-state";

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

type CreateInputOverrides = Partial<
  Omit<AgentStudioSelectedSessionContextInput, "selectedSession">
> & {
  selectedSession?: Partial<AgentStudioSelectedSessionState>;
};

const createInput = (
  overrides: CreateInputOverrides = {},
): AgentStudioSelectedSessionContextInput => {
  const { selectedSession: selectedSessionOverrides = {}, ...inputOverrides } = overrides;
  const selectedTask = createTaskCardFixture({ id: "task-1", title: "Task 1" });
  const sessionsForTask = overrides.sessionsForTask ?? [];
  const loadedSession = selectedSessionOverrides.loadedSession ?? null;
  const selectedSessionIdentity =
    selectedSessionOverrides.identity !== undefined
      ? selectedSessionOverrides.identity
      : loadedSession
        ? toAgentSessionIdentity(loadedSession)
        : null;
  const selectedSessionActivityState =
    selectedSessionOverrides.activityState !== undefined
      ? selectedSessionOverrides.activityState
      : loadedSession
        ? getAgentSessionActivityStateFromSession(loadedSession)
        : null;
  const selectedSessionModel =
    selectedSessionOverrides.selectedModel !== undefined
      ? selectedSessionOverrides.selectedModel
      : (loadedSession?.selectedModel ?? null);

  return {
    taskId: "task-1",
    role: "spec",
    selectedTask,
    sessionsForTask,
    allSessionSummaries: overrides.allSessionSummaries ?? sessionsForTask,
    selectedSession: {
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      selectedModel: selectedSessionModel,
      loadedSession,
      runtimeData: selectedSessionOverrides.runtimeData ?? {
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
        error: null,
      },
      runtimeReadiness: selectedSessionOverrides.runtimeReadiness ?? {
        state: "ready",
        message: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      transcriptState:
        selectedSessionOverrides.transcriptState ?? createSelectedSessionTranscriptStateFixture(),
      sessionAuxiliaryError: selectedSessionOverrides.sessionAuxiliaryError ?? null,
    },
    hasActiveGitConflict: false,
    documents: {
      specDoc: createDoc("spec"),
      planDoc: createDoc("plan"),
      qaDoc: createDoc("qa"),
    },
    sessionActions: {
      isSessionWorking: false,
      onSubmitQuestionAnswers: async () => {},
      isSubmittingQuestionByRequestId: {},
      isSubmittingApprovalByRequestId: {},
      approvalReplyErrorByRequestId: {},
      onReplyApproval: async () => {},
    },
    roleLabelByRole: AGENT_ROLE_LABELS,
    ...inputOverrides,
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
        selectedSession: { loadedSession: null },
      }),
    );

    expect(context.documents.activeDocument).toBeNull();
    expect(context.selectedSession.runtimeData.error).toBeNull();
  });

  test("maps active document from selected role semantics", () => {
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
          selectedSession: { loadedSession: session },
          sessionsForTask: [toAgentSessionSummary(session)],
          allSessionSummaries: [toAgentSessionSummary(session)],
        }),
      );

      expect(context.documents.activeDocument?.title ?? null).toBe(expectedTitle);
    }
  });

  test("keeps selected-session identity authoritative when loaded session state is stale", () => {
    const selectedSession = createSession({
      externalSessionId: "shared-session",
      role: "planner",
      workingDirectory: "/repo/selected-worktree",
    });
    const staleLoadedSession = createSession({
      externalSessionId: "shared-session",
      role: "spec",
      workingDirectory: "/repo/stale-worktree",
    });
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        role: "planner",
        selectedSession: {
          identity: toAgentSessionIdentity(selectedSession),
          loadedSession: staleLoadedSession,
        },
        sessionsForTask: [toAgentSessionSummary(selectedSession)],
        allSessionSummaries: [toAgentSessionSummary(selectedSession)],
      }),
    );

    expect(context.selectedSession.identity).toEqual(toAgentSessionIdentity(selectedSession));
    expect(context.workflow.sessionSelectorValue).toBe(agentSessionIdentityKey(selectedSession));
    expect(context.role).toBe("planner");
    expect(context.documents.activeDocument?.title).toBe("Implementation Plan");
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

    expect(context.role).toBe("planner");
    expect(context.workflow.selectedRoleAvailable).toBe(false);
    expect(context.workflow.selectedRoleReadOnlyReason).toContain("Planner is unavailable");
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
        selectedSession: { loadedSession: qaSession },
        sessionsForTask: [toAgentSessionSummary(qaSession)],
        allSessionSummaries: [toAgentSessionSummary(qaSession)],
      }),
    );

    expect(context.workflow.selectedRoleAvailable).toBe(false);
    expect(context.selectedSession.loadedSession).toBe(qaSession);
  });

  test("projects selected runtime data for chat adaptation", () => {
    const loadedSession = createSession();
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        selectedSession: {
          loadedSession,
          runtimeData: {
            modelCatalog: null,
            todos: [],
            isLoadingModelCatalog: true,
            error: null,
          },
        },
      }),
    );

    expect(context.selectedSession.loadedSession).toBe(loadedSession);
    expect(context.selectedSession.runtimeData.isLoadingModelCatalog).toBe(true);
    expect(context.selectedSession.runtimeData.todos).toEqual([]);
  });

  test("projects runtime readiness and runtime-data errors without masking", () => {
    const refreshChecks = mock(async () => {});
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        selectedSession: {
          runtimeData: {
            modelCatalog: null,
            todos: [],
            isLoadingModelCatalog: false,
            error: "session todos unavailable",
          },
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "runtime_waiting",
          }),
          runtimeReadiness: {
            state: "blocked",
            message: "Runtime unavailable",
            isLoadingChecks: true,
            refreshChecks,
          },
        },
      }),
    );

    expect(context.selectedSession.runtimeData.error).toBe("session todos unavailable");
    expect(context.selectedSession.transcriptState).toEqual({ kind: "runtime_waiting" });
    expect(context.selectedSession.runtimeReadiness).toMatchObject({
      state: "blocked",
      message: "Runtime unavailable",
      isLoadingChecks: true,
    });
    expect(context.selectedSession.runtimeReadiness.refreshChecks).toBe(refreshChecks);
  });

  test("marks no-session task view as waiting while runtime startup is in progress", () => {
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        sessionsForTask: [],
        allSessionSummaries: [],
        selectedSession: {
          loadedSession: null,
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "runtime_waiting",
          }),
          runtimeReadiness: {
            state: "checking",
            message: null,
            isLoadingChecks: true,
            refreshChecks: async () => {},
          },
        },
      }),
    );

    expect(context.selectedSession.transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("does not treat generic readiness checking as runtime startup", () => {
    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        sessionsForTask: [],
        allSessionSummaries: [],
        selectedSession: {
          loadedSession: null,
          transcriptState: createSelectedSessionTranscriptStateFixture(),
          runtimeReadiness: {
            state: "checking",
            message: null,
            isLoadingChecks: true,
            refreshChecks: async () => {},
          },
        },
      }),
    );

    expect(context.selectedSession.transcriptState).toEqual({ kind: "visible" });
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
        selectedSession: { loadedSession: session },
        sessionsForTask: [toAgentSessionSummary(session)],
        allSessionSummaries: [
          toAgentSessionSummary(session),
          toAgentSessionSummary(subagentSession),
        ],
        sessionActions: {
          ...createInput().sessionActions,
          onSubmitQuestionAnswers: questionReply,
          isSubmittingQuestionByRequestId: { "question-main": true },
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
    expect(context.pendingInput.waitingInputPlaceholder).toBe(
      "Resolve the pending questions and approval requests above to continue",
    );
    expect(context.pendingInput.pendingQuestionRequests).toBe(session.pendingQuestions);
    expect(context.pendingInput.pendingApprovalRequests).toBe(session.pendingApprovals);
    expect(context.pendingInput.approvals).toMatchObject({
      canReply: true,
      isSubmittingByRequestId: { "approval-main": true },
      errorByRequestId: { "approval-main": "failed" },
    });
    expect(context.pendingInput.approvals.onReply).toBe(approvalReply);
    expect(context.pendingInput.subagentPendingApprovalCountBySessionKey).toEqual({
      [agentSessionIdentityKey(session)]: 1,
      [agentSessionIdentityKey(subagentSession)]: 1,
    });
    expect(context.pendingInput.subagentPendingQuestionCountBySessionKey).toEqual({
      [agentSessionIdentityKey(session)]: 1,
      [agentSessionIdentityKey(subagentSession)]: 1,
    });
  });

  test("indexes parent-visible subagent pending input by child session identity", () => {
    const childSession = toAgentSessionIdentity({
      externalSessionId: "session-child",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });
    const parentSession = createSession({
      externalSessionId: "session-parent",
      workingDirectory: "/repo/worktree",
      pendingApprovals: [
        {
          requestId: "approval-child",
          requestType: "runtime_tool",
          title: "Approve subagent tool",
          summary: "Approve a subagent tool call.",
          tool: { name: "shell" },
          mutation: "mutating",
          supportedReplyOutcomes: ["approve_once", "reject"],
          responseSession: childSession,
          source: {
            kind: "subagent",
            parentExternalSessionId: "session-parent",
            childExternalSessionId: "session-child",
            subagentCorrelationKey: "part:assistant-parent:subtask",
          },
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-child",
          questions: [],
          source: {
            kind: "subagent",
            parentExternalSessionId: "session-parent",
            childExternalSessionId: "session-child",
            subagentCorrelationKey: "part:assistant-parent:subtask",
          },
        },
      ],
    });

    const context = buildAgentStudioSelectedSessionContext(
      createInput({
        selectedSession: { loadedSession: parentSession },
        sessionsForTask: [],
        allSessionSummaries: [],
      }),
    );

    expect(context.pendingInput.subagentPendingApprovalCountBySessionKey).toEqual({
      [agentSessionIdentityKey(childSession)]: 1,
    });
    expect(context.pendingInput.subagentPendingQuestionCountBySessionKey).toEqual({
      [agentSessionIdentityKey(childSession)]: 1,
    });
  });

  test("disables pending input actions when the selected session has no pending items", () => {
    const noActiveSessionContext = buildAgentStudioSelectedSessionContext(
      createInput({ selectedSession: { loadedSession: null } }),
    );

    expect(noActiveSessionContext.pendingInput.pendingQuestions.canSubmit).toBe(false);
    expect(noActiveSessionContext.pendingInput.approvals.canReply).toBe(false);
    expect(noActiveSessionContext.pendingInput.waitingInputPlaceholder).toBeNull();

    const idleSession = createSession({ pendingApprovals: [], pendingQuestions: [] });
    const idleContext = buildAgentStudioSelectedSessionContext(
      createInput({
        selectedSession: { loadedSession: idleSession },
        sessionsForTask: [toAgentSessionSummary(idleSession)],
        allSessionSummaries: [toAgentSessionSummary(idleSession)],
      }),
    );

    expect(idleContext.pendingInput.pendingQuestions.canSubmit).toBe(false);
    expect(idleContext.pendingInput.approvals.canReply).toBe(false);
    expect(idleContext.pendingInput.waitingInputPlaceholder).toBeNull();
  });
});
