import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { withEditedTaskWorkflow } from "@/test-utils/edited-task-workflow";
import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import {
  type AgentStudioSessionQuickActionOption,
  buildAgentStudioQuickActions,
  buildGitConflictQuickAction,
  buildRoleEnabledMapForTask,
  selectPrimaryAgentStudioQuickAction,
  withGitConflictQuickAction,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { createAgentSessionSummaryFixture } from "./agent-studio-test-utils";

const buildSession = (
  overrides: Parameters<typeof createAgentSessionSummaryFixture>[0] = {},
): AgentSessionSummary => createAgentSessionSummaryFixture(overrides);

const buildPullRequest = () => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/example/repo/pull/42",
  state: "open" as const,
  createdAt: "2026-02-20T10:00:00.000Z",
  updatedAt: "2026-02-20T10:05:00.000Z",
});

/** The session start actions only. The task actions have their own tests. */
const buildSessionQuickActions = (
  ...args: Parameters<typeof buildAgentStudioQuickActions>
): AgentStudioSessionQuickActionOption[] =>
  buildAgentStudioQuickActions(...args).filter(
    (option): option is AgentStudioSessionQuickActionOption => option.kind !== "task_action",
  );

describe("agent-studio-quick-actions", () => {
  const buildPrActionArgs = (): Parameters<typeof buildAgentStudioQuickActions>[0] => {
    const task = buildTask({
      id: "task-1",
      status: "human_review",
      availableActions: ["human_request_changes"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: true },
      },
    });
    const builderSession = buildSession({
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: task.id,
        role: "build",
      },
    });
    return {
      selectedTask: task,
      sessionsForTask: [builderSession],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    };
  };

  test("keeps a plain event before its following feedback launch", () => {
    const { alpha, board } = createSharedBoardWorkflows();
    const task = withEditedTaskWorkflow(
      createWorkflowTaskCardFixture(alpha, board, { status: "shared_review" }),
      (definition) => {
        const action = definition.actions.find(({ id }) => id === "alpha_hold");
        if (!action || action.kind !== "event") throw new Error("Expected plain event action");
        action.launchActionIds = ["alpha_write_revise"];
      },
    );
    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    });
    expect(
      options.find(
        (option) => option.kind === "task_action" && option.taskAction.action === "alpha_hold",
      ),
    ).toMatchObject({
      kind: "task_action",
      taskAction: { kind: "workflow", action: "alpha_hold" },
    });
  });

  test("describes each action with the workflow description, never with its label", () => {
    const options = buildAgentStudioQuickActions(buildPrActionArgs());

    expect(
      options.find(
        (option) =>
          option.kind === "task_action" && option.taskAction.action === "human_request_changes",
      )?.description,
    ).toBe("Send your feedback to the Builder, which applies the changes.");
    expect(
      options.find((option) => option.kind === "session_start" && option.role === "spec")
        ?.description,
    ).toBe("Start a Spec session that writes the task spec.");
    for (const option of options) expect(option.description).not.toBe(option.label);
  });

  test("hides unsupported Pull Request generation", () => {
    const actions = buildSessionQuickActions({
      ...buildPrActionArgs(),
      gitProviderContext: null,
    });
    expect(actions.some((option) => option.launchActionId === "pull_request")).toBe(false);
  });

  test("disables Pull Request generation when provider health blocks use", () => {
    const actions = buildSessionQuickActions({
      ...buildPrActionArgs(),
      gitProviderContext: createGitProviderContextFixture({ available: false }),
    });
    expect(actions.find((option) => option.launchActionId === "pull_request")).toMatchObject({
      disabled: true,
      disabledReason: "Sign in to GitHub CLI.",
    });
  });

  test("disables Pull Request generation when the provider refresh fails", () => {
    const actions = buildSessionQuickActions({
      ...buildPrActionArgs(),
      gitProviderContext: createGitProviderContextFixture(),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(actions.find((option) => option.launchActionId === "pull_request")).toMatchObject({
      disabled: true,
      disabledReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("keeps Pull Request generation visible when the initial provider read fails", () => {
    const actions = buildSessionQuickActions({
      ...buildPrActionArgs(),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(actions.find((option) => option.launchActionId === "pull_request")).toMatchObject({
      disabled: true,
      disabledReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("hides unsupported Pull Request generation when the provider refresh fails", () => {
    const actions = buildSessionQuickActions({
      ...buildPrActionArgs(),
      gitProviderContext: createGitProviderContextFixture({ supportsPullRequests: false }),
      gitProviderReadError: "Could not load the current Git provider: connection failed",
    });

    expect(actions.some((option) => option.launchActionId === "pull_request")).toBe(false);
  });

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
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    const sessionsForTask = [
      buildSession({
        sessionAssociation: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "build",
        },
        externalSessionId: "builder-1",
      }),
    ];

    const options = buildSessionQuickActions({
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
    ]);
    expect(
      buildAgentStudioQuickActions({
        selectedTask: task,
        sessionsForTask,
        roleEnabledByTask: buildRoleEnabledMapForTask(task),
        createSessionDisabled: false,
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "task_action",
        taskAction: { kind: "workflow", action: "human_request_changes" },
      }),
    );
    expect(options.some((option) => option.launchActionId === "pull_request")).toBe(false);
    expect(selectPrimaryAgentStudioQuickAction(options)?.id).toBe("quick:spec_initial");
    expect(selectPrimaryAgentStudioQuickAction(options)?.label).toBe("Start Spec");
  });

  test("selects the primary quick action from task workflow priority", () => {
    const baseTask = {
      id: "task-1",
      availableActions: ["set_spec", "set_plan", "build_start", "qa_start"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    };

    const specReadyTask = buildTask({ ...baseTask, status: "spec_ready" });
    const specReadyOptions = buildSessionQuickActions({
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
    const readyForDevOptions = buildSessionQuickActions({
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
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "task-1",
        role: "build",
      },

      externalSessionId: "builder-1",
    });
    const humanReviewOptions = buildSessionQuickActions({
      selectedTask: humanReviewTask,
      sessionsForTask: [humanReviewBuilderSession],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTask),
      createSessionDisabled: false,
      gitProviderContext: createGitProviderContextFixture(),
    });
    expect(selectPrimaryAgentStudioQuickAction(humanReviewOptions)).toMatchObject({
      launchActionId: "pull_request",
      label: "Generate Pull Request",
    });
    expect(humanReviewOptions[0]).toMatchObject({
      launchActionId: "pull_request",
      initialSourceSession: expect.objectContaining({
        externalSessionId: humanReviewBuilderSession.externalSessionId,
      }),
    });
    expect(humanReviewOptions.map((option) => option.launchActionId)).toEqual([
      "pull_request",
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
    ]);
    expect(
      buildAgentStudioQuickActions({
        selectedTask: humanReviewTask,
        sessionsForTask: [humanReviewBuilderSession],
        roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTask),
        createSessionDisabled: false,
        gitProviderContext: createGitProviderContextFixture(),
      }).filter(
        (option) =>
          option.kind === "task_action" && option.taskAction.action === "human_request_changes",
      ),
    ).toHaveLength(1);

    const humanReviewTaskWithPullRequest = buildTask({
      ...humanReviewTask,
      pullRequest: buildPullRequest(),
    });
    const humanReviewWithPullRequestOptions = buildSessionQuickActions({
      selectedTask: humanReviewTaskWithPullRequest,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTaskWithPullRequest),
      createSessionDisabled: false,
      gitProviderContext: createGitProviderContextFixture(),
    });

    expect(
      selectPrimaryAgentStudioQuickAction(
        buildAgentStudioQuickActions({
          selectedTask: humanReviewTaskWithPullRequest,
          sessionsForTask: [],
          roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTaskWithPullRequest),
          createSessionDisabled: false,
          gitProviderContext: createGitProviderContextFixture(),
        }),
      ),
    ).toMatchObject({
      kind: "task_action",
      taskAction: { kind: "workflow", action: "human_request_changes" },
      label: "Request Changes",
    });
    expect(humanReviewWithPullRequestOptions.map((option) => option.launchActionId)).toEqual([
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
      "pull_request",
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
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const options = buildSessionQuickActions({
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

  describe("task actions", () => {
    const buildReviewArgs = (
      overrides: Partial<Parameters<typeof buildAgentStudioQuickActions>[0]> = {},
    ): Parameters<typeof buildAgentStudioQuickActions>[0] => ({
      ...buildPrActionArgs(),
      selectedTask: buildTask({
        id: "task-1",
        status: "human_review",
        availableActions: ["human_request_changes", "human_approve"],
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: { required: true, canSkip: false, available: true, completed: true },
          build: { required: true, canSkip: false, available: true, completed: true },
          qa: { required: true, canSkip: false, available: true, completed: true },
        },
      }),
      gitProviderContext: createGitProviderContextFixture(),
      ...overrides,
    });

    test("puts Approve Task after the session actions when a Git provider is enabled", () => {
      const options = buildAgentStudioQuickActions(buildReviewArgs());

      expect(options.at(-1)).toMatchObject({ id: "task:human_approve", label: "Approve Task" });
      expect(selectPrimaryAgentStudioQuickAction(options)?.id).not.toBe("task:human_approve");
    });

    test("keeps Approve Task out of the primary slot while a session is working", () => {
      const options = buildAgentStudioQuickActions(
        buildReviewArgs({ createSessionDisabled: true }),
      );

      expect(selectPrimaryAgentStudioQuickAction(options)).toMatchObject({
        launchActionId: "pull_request",
        disabled: true,
      });
    });

    test("leads with Approve Task in human review without an enabled Git provider", () => {
      const options = buildAgentStudioQuickActions(
        buildReviewArgs({
          gitProviderContext: createGitProviderContextFixture({ enabled: false }),
        }),
      );

      expect(selectPrimaryAgentStudioQuickAction(options)?.id).toBe("task:human_approve");
    });

    test("leads with Close Task and its marker for a merged task branch", () => {
      const options = buildAgentStudioQuickActions(
        buildReviewArgs({
          mergedTarget: "origin/main",
          selectedTask: buildTask({
            ...buildReviewArgs().selectedTask!,
            availableActions: ["human_approve", "human_request_changes"],
          }),
        }),
      );

      expect(selectPrimaryAgentStudioQuickAction(options)).toMatchObject({
        id: "task:close_task",
        label: "Close Task",
        mergedTarget: "origin/main",
      });
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
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const options = buildSessionQuickActions({
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
    // The host offers change requests in every review status.
    const aiReviewTaskWithoutPullRequest = buildTask({
      id: "task-1",
      status: "ai_review",
      availableActions: ["human_request_changes"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    const aiReviewWithoutPullRequestOptions = buildSessionQuickActions({
      selectedTask: aiReviewTaskWithoutPullRequest,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTaskWithoutPullRequest),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(aiReviewWithoutPullRequestOptions)).toMatchObject({
      launchActionId: "qa_review",
    });
    expect(
      aiReviewWithoutPullRequestOptions.some((option) => option.launchActionId === "pull_request"),
    ).toBe(false);

    const aiReviewTaskWithPullRequest = buildTask({
      ...aiReviewTaskWithoutPullRequest,
      pullRequest: buildPullRequest(),
    });
    const aiReviewWithPullRequestOptions = buildSessionQuickActions({
      selectedTask: aiReviewTaskWithPullRequest,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTaskWithPullRequest),
      createSessionDisabled: false,
    });
    expect(selectPrimaryAgentStudioQuickAction(aiReviewWithPullRequestOptions)).toMatchObject({
      launchActionId: "qa_review",
    });
    expect(
      aiReviewWithPullRequestOptions.some((option) => option.launchActionId === "pull_request"),
    ).toBe(false);
    expect(
      buildAgentStudioQuickActions({
        selectedTask: aiReviewTaskWithPullRequest,
        sessionsForTask: [],
        roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTaskWithPullRequest),
        createSessionDisabled: false,
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "task_action",
        taskAction: { kind: "workflow", action: "human_request_changes" },
      }),
    );

    const qaRejectedTask = buildTask({
      id: "task-1",
      status: "in_progress",
      availableActions: [],
      artifactSummary: {
        spec: { present: true },
        plan: { present: true },
        qaReport: { present: true, verdict: "rejected" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const qaRejectedOptions = buildSessionQuickActions({
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
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const roleEnabledByTask = buildRoleEnabledMapForTask(task);
    const workflowOptions = buildSessionQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask,
      createSessionDisabled: false,
    });
    const gitConflictQuickAction = buildGitConflictQuickAction({
      selectedTask: task,
      roleEnabledByTask,
      createSessionDisabled: false,
    });
    if (!gitConflictQuickAction) {
      throw new Error("Expected the git conflict quick action for an enabled Builder role.");
    }

    expect(
      workflowOptions.some(
        (option) => option.launchActionId === "build_rebase_conflict_resolution",
      ),
    ).toBe(false);
    expect(gitConflictQuickAction).toMatchObject({
      launchActionId: "build_rebase_conflict_resolution",
      postStartAction: "send_message",
      disabled: false,
    });

    const { quickActions, primaryQuickAction } = withGitConflictQuickAction(
      workflowOptions,
      gitConflictQuickAction,
    );
    expect(quickActions).toEqual([gitConflictQuickAction, ...workflowOptions]);
    expect(primaryQuickAction).toBe(gitConflictQuickAction);
  });

  test("disables git conflict resolution while a session is working", () => {
    const roleEnabledByTask = { spec: false, planner: false, build: true, qa: false };

    expect(
      buildGitConflictQuickAction({
        selectedTask: buildTask({
          id: "task-1",
          agentWorkflows: {
            spec: { required: true, canSkip: false, available: false, completed: true },
            planner: { required: true, canSkip: false, available: false, completed: true },
            build: { required: true, canSkip: false, available: true, completed: false },
            qa: { required: true, canSkip: false, available: false, completed: false },
          },
        }),
        roleEnabledByTask,
        createSessionDisabled: true,
      }),
    ).toMatchObject({
      disabled: true,
      disabledReason: "Wait for the current session to finish.",
    });
    expect(
      buildGitConflictQuickAction({
        selectedTask: null,
        roleEnabledByTask,
        createSessionDisabled: false,
      }),
    ).toBeNull();
  });

  test("only proposes pull-request generation for review states", () => {
    const nonReviewTask = buildTask({
      id: "task-1",
      status: "ready_for_dev",
      availableActions: ["build_start"],
    });
    const nonReviewOptions = buildSessionQuickActions({
      selectedTask: nonReviewTask,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(nonReviewTask),
      createSessionDisabled: false,
    });

    expect(nonReviewOptions.some((option) => option.launchActionId === "pull_request")).toBe(false);

    const aiReviewTask = buildTask({
      id: "task-1",
      status: "ai_review",
      availableActions: [],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: false, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const aiReviewOptions = buildSessionQuickActions({
      selectedTask: aiReviewTask,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: buildRoleEnabledMapForTask(aiReviewTask),
      createSessionDisabled: false,
    });

    expect(aiReviewOptions.some((option) => option.launchActionId === "pull_request")).toBe(false);

    const humanReviewTask = buildTask({
      ...aiReviewTask,
      status: "human_review",
    });
    const humanReviewBuilderSession = buildSession({
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "task-1",
        role: "build",
      },

      externalSessionId: "builder-1",
    });
    const humanReviewOptions = buildSessionQuickActions({
      selectedTask: humanReviewTask,
      sessionsForTask: [humanReviewBuilderSession],
      roleEnabledByTask: buildRoleEnabledMapForTask(humanReviewTask),
      createSessionDisabled: false,
      gitProviderContext: createGitProviderContextFixture(),
    });

    expect(humanReviewOptions).toContainEqual(
      expect.objectContaining({
        launchActionId: "pull_request",
        initialSourceSession: expect.objectContaining({
          externalSessionId: humanReviewBuilderSession.externalSessionId,
        }),
      }),
    );
  });

  test("keeps review-state pull-request quick action disabled without a builder source", () => {
    const task = buildTask({
      id: "task-1",
      status: "human_review",
      availableActions: ["human_request_changes"],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: true },
      },
    });
    const options = buildSessionQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
      gitProviderContext: createGitProviderContextFixture(),
    });

    expect(options[0]).toMatchObject({
      launchActionId: "pull_request",
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    });
    expect(options.map((option) => option.launchActionId)).toEqual([
      "pull_request",
      "qa_review",
      "build_implementation_start",
      "spec_initial",
      "planner_initial",
    ]);
    expect(
      selectPrimaryAgentStudioQuickAction(
        buildAgentStudioQuickActions({
          selectedTask: task,
          sessionsForTask: [],
          roleEnabledByTask: buildRoleEnabledMapForTask(task),
          createSessionDisabled: false,
          gitProviderContext: createGitProviderContextFixture(),
        }),
      ),
    ).toMatchObject({
      kind: "task_action",
      taskAction: { kind: "workflow", action: "human_request_changes" },
      label: "Request Changes",
      disabled: false,
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
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });

    const options = buildSessionQuickActions({
      selectedTask: task,
      sessionsForTask: [
        buildSession({
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "build",
          },
          externalSessionId: "builder-1",
        }),
      ],
      roleEnabledByTask: {
        spec: true,
        planner: true,
        build: false,
        qa: true,
      },
      createSessionDisabled: false,
    });

    expect(options.map((option) => option.launchActionId)).toEqual([
      "qa_review",
      "spec_initial",
      "planner_initial",
    ]);
    expect(
      buildGitConflictQuickAction({
        selectedTask: task,
        roleEnabledByTask: { spec: true, planner: true, build: false, qa: true },
        createSessionDisabled: false,
      }),
    ).toBeNull();
    expect(
      options.some((option) => option.role === "build" || option.launchActionId === "pull_request"),
    ).toBe(false);
  });
});
