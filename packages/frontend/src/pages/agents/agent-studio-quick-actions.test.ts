import { describe, expect, test } from "bun:test";
import type { TaskAction } from "@openducktor/contracts";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildAgentStudioQuickActions,
  selectPrimaryAgentStudioQuickAction,
} from "./agent-studio-quick-actions";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import { buildRoleEnabledMapForTask } from "./agents-page-session-tabs";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture(overrides);

const buildPullRequest = () => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/example/repo/pull/42",
  state: "open" as const,
  createdAt: "2026-02-20T10:00:00.000Z",
  updatedAt: "2026-02-20T10:05:00.000Z",
});

describe("agent-studio-quick-actions", () => {
  test("builds quick actions from backend actions, role workflows, and builder sessions", () => {
    const task = buildTask({
      id: "task-1",
      availableActions: [
        "set_spec",
        "set_plan",
        "build_start",
        "qa_start",
        "human_request_changes",
      ],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    const sessionsForTask = [
      buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
    ];

    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask,
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    });

    expect(options.map((option) => option.launchActionId)).toEqual([
      "spec_initial",
      "planner_initial",
      "build_implementation_start",
      "qa_review",
      "build_after_human_request_changes",
    ]);
    expect(
      options.find((option) => option.launchActionId === "build_after_human_request_changes")
        ?.requiresHumanFeedback,
    ).toBe(true);
    expect(
      options.some((option) => option.launchActionId === "build_pull_request_generation"),
    ).toBe(false);
    expect(selectPrimaryAgentStudioQuickAction(options)?.launchActionId).toBe("spec_initial");
    expect(selectPrimaryAgentStudioQuickAction(options)?.label).toBe("Start Spec");
  });

  test("selects the primary quick action from task workflow priority", () => {
    const baseTask = {
      id: "task-1",
      availableActions: ["set_spec", "set_plan", "build_start", "qa_start"] satisfies TaskAction[],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    };

    const specReadyTask = buildTask({ ...baseTask, status: "spec_ready" });
    const specReadyOptions = buildAgentStudioQuickActions({
      selectedTask: specReadyTask,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(specReadyTask),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(specReadyOptions)).toMatchObject({
      launchActionId: "planner_initial",
      label: "Start Planner",
    });

    const readyForDevTask = buildTask({ ...baseTask, status: "ready_for_dev" });
    const readyForDevOptions = buildAgentStudioQuickActions({
      selectedTask: readyForDevTask,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(readyForDevTask),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(readyForDevOptions)).toMatchObject({
      launchActionId: "build_implementation_start",
      label: "Start Implementation",
    });

    const humanReviewTask = buildTask({
      ...baseTask,
      status: "human_review",
      availableActions: [
        "set_spec",
        "set_plan",
        "build_start",
        "qa_start",
        "human_request_changes",
      ],
    });
    const humanReviewBuilderSession = buildSession({
      taskId: "task-1",
      role: "build",
      externalSessionId: "builder-1",
    });
    const humanReviewOptions = buildAgentStudioQuickActions({
      selectedTask: humanReviewTask,
      sessionsForTask: [humanReviewBuilderSession],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTask),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(humanReviewOptions)).toMatchObject({
      launchActionId: "build_pull_request_generation",
      label: "Generate Pull Request",
    });
    expect(humanReviewOptions[0]).toMatchObject({
      launchActionId: "build_pull_request_generation",
      initialSourceExternalSessionId: agentSessionIdentityKey(humanReviewBuilderSession),
    });
    expect(humanReviewOptions.map((option) => option.launchActionId)).toEqual([
      "build_pull_request_generation",
      "build_after_human_request_changes",
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
    ]);
    expect(
      humanReviewOptions.filter(
        (option) => option.launchActionId === "build_after_human_request_changes",
      ),
    ).toHaveLength(1);

    const humanReviewTaskWithPullRequest = buildTask({
      ...humanReviewTask,
      pullRequest: buildPullRequest(),
    });
    const humanReviewWithPullRequestOptions = buildAgentStudioQuickActions({
      selectedTask: humanReviewTaskWithPullRequest,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTaskWithPullRequest),
      createSessionDisabled: false,
    });

    expect(selectPrimaryAgentStudioQuickAction(humanReviewWithPullRequestOptions)).toMatchObject({
      launchActionId: "build_after_human_request_changes",
      label: "Request Changes",
      requiresHumanFeedback: true,
    });
    expect(humanReviewWithPullRequestOptions.map((option) => option.launchActionId)).toEqual([
      "build_after_human_request_changes",
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
      "build_pull_request_generation",
    ]);
  });

  test("keeps completed workflow roles in the dropdown while prioritizing current work", () => {
    const task = buildTask({
      id: "task-1",
      status: "in_progress",
      availableActions: ["set_spec", "set_plan", "build_start"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    });

    expect(options.map((option) => option.launchActionId)).toEqual([
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
    ]);
    expect(selectPrimaryAgentStudioQuickAction(options)).toMatchObject({
      launchActionId: "build_implementation_start",
      label: "Start Implementation",
    });
  });

  test("keeps the best primary quick action label when a session disables starting", () => {
    const task = buildTask({
      id: "task-1",
      status: "in_progress",
      availableActions: ["set_spec", "set_plan"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: true,
    });

    expect(selectPrimaryAgentStudioQuickAction(options)).toMatchObject({
      launchActionId: "build_implementation_start",
      label: "Start Implementation",
      disabled: true,
      disabledReason: "Wait for the current session to finish.",
    });
  });

  test("uses status-specific primary quick actions for AI review and QA rejection", () => {
    const aiReviewTaskWithoutPullRequest = buildTask({
      id: "task-1",
      status: "ai_review",
      availableActions: [],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    const aiReviewWithoutPullRequestOptions = buildAgentStudioQuickActions({
      selectedTask: aiReviewTaskWithoutPullRequest,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTaskWithoutPullRequest),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(aiReviewWithoutPullRequestOptions)).toMatchObject({
      launchActionId: "qa_review",
    });
    expect(
      aiReviewWithoutPullRequestOptions.some(
        (option) => option.launchActionId === "build_pull_request_generation",
      ),
    ).toBe(false);

    const aiReviewTaskWithPullRequest = buildTask({
      ...aiReviewTaskWithoutPullRequest,
      pullRequest: buildPullRequest(),
    });
    const aiReviewWithPullRequestOptions = buildAgentStudioQuickActions({
      selectedTask: aiReviewTaskWithPullRequest,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTaskWithPullRequest),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(aiReviewWithPullRequestOptions)).toMatchObject({
      launchActionId: "qa_review",
    });
    expect(
      aiReviewWithPullRequestOptions.some(
        (option) => option.launchActionId === "build_pull_request_generation",
      ),
    ).toBe(false);
    expect(
      aiReviewWithPullRequestOptions.find(
        (option) => option.launchActionId === "build_after_human_request_changes",
      ),
    ).toMatchObject({
      requiresHumanFeedback: true,
    });

    const qaRejectedTask = buildTask({
      id: "task-1",
      status: "in_progress",
      availableActions: [],
      documentSummary: {
        spec: { has: true },
        plan: { has: true },
        qaReport: { has: true, verdict: "rejected" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const qaRejectedOptions = buildAgentStudioQuickActions({
      selectedTask: qaRejectedTask,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(qaRejectedTask),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(qaRejectedOptions)).toMatchObject({
      launchActionId: "build_after_qa_rejected",
      label: "Address QA Feedbacks",
    });
  });

  test("surfaces active git conflict resolution as the primary quick action", () => {
    const task = buildTask({
      id: "task-1",
      availableActions: ["build_start"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
      hasActiveGitConflict: true,
    });

    expect(options[0]).toMatchObject({
      launchActionId: "build_rebase_conflict_resolution",
      postStartAction: "send_message",
      disabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(options)?.launchActionId).toBe(
      "build_rebase_conflict_resolution",
    );
  });

  test("only proposes pull-request generation for review states", () => {
    const nonReviewTask = buildTask({
      id: "task-1",
      status: "ready_for_dev",
      availableActions: ["build_start"],
    });
    const nonReviewOptions = buildAgentStudioQuickActions({
      selectedTask: nonReviewTask,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(nonReviewTask),
      createSessionDisabled: false,
    });

    expect(
      nonReviewOptions.some((option) => option.launchActionId === "build_pull_request_generation"),
    ).toBe(false);

    const aiReviewTask = buildTask({
      id: "task-1",
      status: "ai_review",
      availableActions: [],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const aiReviewOptions = buildAgentStudioQuickActions({
      selectedTask: aiReviewTask,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTask),
      createSessionDisabled: false,
    });

    expect(
      aiReviewOptions.some((option) => option.launchActionId === "build_pull_request_generation"),
    ).toBe(false);

    const humanReviewTask = buildTask({
      ...aiReviewTask,
      status: "human_review",
    });
    const humanReviewBuilderSession = buildSession({
      taskId: "task-1",
      role: "build",
      externalSessionId: "builder-1",
    });
    const humanReviewOptions = buildAgentStudioQuickActions({
      selectedTask: humanReviewTask,
      sessionsForTask: [humanReviewBuilderSession],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTask),
      createSessionDisabled: false,
    });

    expect(humanReviewOptions).toContainEqual(
      expect.objectContaining({
        launchActionId: "build_pull_request_generation",
        initialSourceExternalSessionId: agentSessionIdentityKey(humanReviewBuilderSession),
      }),
    );
  });

  test("keeps review-state pull-request quick action disabled without a builder source", () => {
    const task = buildTask({
      id: "task-1",
      status: "human_review",
      availableActions: [],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: true },
      },
    });
    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    });

    expect(options[0]).toMatchObject({
      launchActionId: "build_pull_request_generation",
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    });
    expect(options.map((option) => option.launchActionId)).toEqual([
      "build_pull_request_generation",
      "build_after_human_request_changes",
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
    ]);
    expect(selectPrimaryAgentStudioQuickAction(options)).toMatchObject({
      launchActionId: "build_after_human_request_changes",
      label: "Request Changes",
      disabled: false,
      requiresHumanFeedback: true,
    });
  });

  test("filters quick actions for unavailable task roles", () => {
    const task = buildTask({
      id: "task-1",
      status: "human_review",
      availableActions: [
        "set_spec",
        "set_plan",
        "build_start",
        "qa_start",
        "human_request_changes",
      ],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });

    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [
        buildSession({ taskId: "task-1", role: "build", externalSessionId: "builder-1" }),
      ],
      roleEnabledByTask: {
        spec: true,
        planner: true,
        build: false,
        qa: true,
      },
      createSessionDisabled: false,
      hasActiveGitConflict: true,
    });

    expect(options.map((option) => option.launchActionId)).toEqual([
      "qa_review",
      "spec_initial",
      "planner_initial",
    ]);
    expect(
      options.some(
        (option) =>
          option.role === "build" || option.launchActionId === "build_pull_request_generation",
      ),
    ).toBe(false);
  });
});
