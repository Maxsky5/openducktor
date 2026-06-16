import { describe, expect, test } from "bun:test";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import { createAgentSessionSummaryFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
} from "./use-agent-studio-page-model-builders";

const createDoc = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createSession = (
  overrides: Parameters<typeof createAgentSessionSummaryFixture>[0] = {},
): AgentSessionSummary =>
  createAgentSessionSummaryFixture({
    status: "idle",
    ...overrides,
  });

const roleLabelByRole = { ...AGENT_ROLE_LABELS } as const;

describe("use-agent-studio-page-model-builders", () => {
  test("buildActiveDocumentForRole maps documents by role", () => {
    const specDoc = createDoc("spec");
    const planDoc = createDoc("plan");
    const qaDoc = createDoc("qa");

    expect(
      buildActiveDocumentForRole({
        activeRole: "spec",
        specDoc,
        planDoc,
        qaDoc,
      })?.title,
    ).toBe("Specification");
    expect(
      buildActiveDocumentForRole({
        activeRole: "planner",
        specDoc,
        planDoc,
        qaDoc,
      })?.title,
    ).toBe("Implementation Plan");
    expect(
      buildActiveDocumentForRole({
        activeRole: "qa",
        specDoc,
        planDoc,
        qaDoc,
      })?.title,
    ).toBe("QA Report");
    expect(
      buildActiveDocumentForRole({
        activeRole: "build",
        specDoc,
        planDoc,
        qaDoc,
      }),
    ).toBeNull();
  });

  test("buildWorkflowModelContext derives role availability and fallback session selector", () => {
    const plannerSession = createSession({
      runtimeKind: "opencode",
      externalSessionId: "planner-session",
      role: "planner",
    });
    const unavailablePlannerTask = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const context = buildWorkflowModelContext({
      selectedTask: unavailablePlannerTask,
      sessionsForTask: [plannerSession],
      activeSession: null,
      role: "planner",
      isSessionWorking: false,
      hasActiveGitConflict: false,
      roleLabelByRole,
    });

    expect(context.selectedInteractionRole).toBe("planner");
    expect(context.selectedRoleAvailable).toBe(false);
    expect(context.selectedRoleReadOnlyReason).toContain("Planner is unavailable");
    const plannerSessionValue = agentSessionIdentityKey(plannerSession);
    expect(context.sessionSelectorValue).toBe(plannerSessionValue);
    expect(context.sessionSelectorAutofocusByValue[plannerSessionValue]).toBe(false);
    expect(context.createSessionDisabled).toBe(false);
  });

  test("buildWorkflowModelContext marks only immediately interactive sessions for header autofocus", () => {
    const specSession = createSession({
      runtimeKind: "opencode",
      externalSessionId: "spec-session",
      role: "spec",
    });
    const qaWaitingSession = createSession({
      runtimeKind: "opencode",
      externalSessionId: "qa-session",
      role: "qa",
      pendingQuestions: [{ requestId: "q-1", questions: [] }],
    });
    const task = createTaskCardFixture({
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });

    const context = buildWorkflowModelContext({
      selectedTask: task,
      sessionsForTask: [specSession, qaWaitingSession],
      activeSession: null,
      role: "spec",
      isSessionWorking: false,
      hasActiveGitConflict: false,
      roleLabelByRole,
    });

    expect(context.sessionSelectorAutofocusByValue).toEqual({
      [agentSessionIdentityKey(specSession)]: true,
      [agentSessionIdentityKey(qaWaitingSession)]: false,
    });
  });

  test("buildWorkflowModelContext includes follow-up build launch action from human feedback", () => {
    const activeSession = createSession({
      runtimeKind: "opencode",
      externalSessionId: "spec-session",
      role: "spec",
    });
    const taskWithFeedback = createTaskCardFixture({
      status: "human_review",
      availableActions: ["human_request_changes", "human_approve"],
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "rejected" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });

    const context = buildWorkflowModelContext({
      selectedTask: taskWithFeedback,
      sessionsForTask: [activeSession],
      activeSession,
      role: "spec",
      isSessionWorking: true,
      hasActiveGitConflict: false,
      roleLabelByRole,
    });

    const optionIds = context.sessionCreateOptions.map((option) => option.id);
    expect(optionIds).toContain("build:build_after_human_request_changes:message_first");
    expect(context.sessionCreateOptions.every((option) => option.disabled)).toBe(true);
    expect(context.primaryQuickAction).toMatchObject({
      launchActionId: "build_pull_request_generation",
      label: "Generate Pull Request",
      disabled: true,
      disabledReason: "Wait for the current session to finish.",
    });
    expect(context.createSessionDisabled).toBe(true);
  });

  test("buildWorkflowModelContext does not treat ai review request changes as human feedback follow-up", () => {
    const taskInAiReview = createTaskCardFixture({
      status: "ai_review",
      availableActions: ["qa_start", "human_request_changes", "human_approve"],
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "approved" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: true },
      },
    });

    const context = buildWorkflowModelContext({
      selectedTask: taskInAiReview,
      sessionsForTask: [],
      activeSession: null,
      role: "build",
      isSessionWorking: false,
      hasActiveGitConflict: false,
      roleLabelByRole,
    });

    expect(context.sessionCreateOptions.map((option) => option.id)).not.toContain(
      "build:build_after_human_request_changes:message_first",
    );
  });

  test("does not expose qa-rejected follow-up build launch action when latest qa verdict is approved", () => {
    const taskWithApprovedQa = createTaskCardFixture({
      status: "human_review",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "approved" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: true },
      },
    });

    const context = buildWorkflowModelContext({
      selectedTask: taskWithApprovedQa,
      sessionsForTask: [],
      activeSession: null,
      role: "build",
      isSessionWorking: false,
      hasActiveGitConflict: false,
      roleLabelByRole,
    });

    expect(context.sessionCreateOptions.map((option) => option.id)).not.toContain(
      "build:build_after_qa_rejected:message_first",
    );
  });
});
