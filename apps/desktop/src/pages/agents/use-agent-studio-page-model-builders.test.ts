import { describe, expect, test } from "bun:test";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  toChatContextUsage,
} from "./use-agent-studio-page-model-builders";

const createDoc = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture({
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

  test("toChatContextUsage preserves optional output limit", () => {
    expect(toChatContextUsage(null)).toBeNull();
    expect(toChatContextUsage({ totalTokens: 120, contextWindow: 4096 })).toEqual({
      totalTokens: 120,
      contextWindow: 4096,
    });
    expect(
      toChatContextUsage({
        totalTokens: 120,
        contextWindow: 4096,
        outputLimit: 1024,
      }),
    ).toEqual({
      totalTokens: 120,
      contextWindow: 4096,
      outputLimit: 1024,
    });
  });

  test("buildWorkflowModelContext derives role availability and fallback session selector", () => {
    const plannerSession = createSession({
      sessionId: "planner-session",
      role: "planner",
      scenario: "planner_initial",
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
      qaDoc: createDoc(""),
      roleLabelByRole,
    });

    expect(context.selectedInteractionRole).toBe("planner");
    expect(context.selectedRoleAvailable).toBe(false);
    expect(context.selectedRoleReadOnlyReason).toContain("Planner is unavailable");
    expect(context.sessionSelectorValue).toBe("planner-session");
    expect(context.createSessionDisabled).toBe(false);
  });

  test("buildWorkflowModelContext includes follow-up build scenarios from QA and human feedback", () => {
    const activeSession = createSession({
      sessionId: "spec-session",
      role: "spec",
      scenario: "spec_initial",
    });
    const taskWithFeedback = createTaskCardFixture({
      status: "human_review",
      availableActions: ["human_request_changes"],
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
      qaDoc: createDoc("latest qa report"),
      roleLabelByRole,
    });

    const optionIds = context.sessionCreateOptions.map((option) => option.id);
    expect(optionIds).toContain("build:build_after_qa_rejected:fresh");
    expect(optionIds).toContain("build:build_after_human_request_changes:fresh");
    expect(context.sessionCreateOptions.every((option) => option.disabled)).toBe(true);
    expect(context.createSessionDisabled).toBe(true);
  });
});
