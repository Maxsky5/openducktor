import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildAgentStudioQuickActions,
  selectPrimaryAgentStudioQuickAction,
} from "./agent-studio-quick-actions";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import { buildRoleEnabledMapForTask } from "./agents-page-session-tabs";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture(overrides);

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
      "build_pull_request_generation",
    ]);
    expect(
      options.find((option) => option.launchActionId === "build_after_human_request_changes")
        ?.requiresHumanFeedback,
    ).toBe(true);
    expect(
      options.find((option) => option.launchActionId === "build_pull_request_generation")
        ?.initialSourceExternalSessionId,
    ).toBe("builder-1");
    expect(selectPrimaryAgentStudioQuickAction(options)?.launchActionId).toBe("spec_initial");
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

  test("keeps pull-request quick action visible but disabled without a builder source", () => {
    const task = buildTask({ id: "task-1", availableActions: [] });
    const options = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
    });

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      launchActionId: "build_pull_request_generation",
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    });
    expect(selectPrimaryAgentStudioQuickAction(options)).toBeNull();
  });
});
