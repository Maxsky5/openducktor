import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentSessionStartMode } from "@openducktor/core";
import {
  buildReusableSessionOptions,
  getSessionLaunchAction,
  LAUNCH_ACTION_LABELS,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
  type SessionStartExistingSessionOption,
  type SessionStartPostAction,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";

export type AgentStudioQuickActionOption = {
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  postStartAction: SessionStartPostAction;
  disabled: boolean;
  disabledReason?: string;
  initialStartMode?: AgentSessionStartMode;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceExternalSessionId?: string | null;
  requiresHumanFeedback?: boolean;
};

const createQuickActionDisabledReason = (createSessionDisabled: boolean): string | null => {
  return createSessionDisabled ? "Wait for the current session to finish." : null;
};

export const buildAgentStudioQuickActions = (params: {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
  hasActiveGitConflict?: boolean;
}): AgentStudioQuickActionOption[] => {
  const task = params.selectedTask;
  if (!task) {
    return [];
  }

  const availableActions = new Set(task.availableActions);
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const createLifecycleOption = (
    id: string,
    role: AgentRole,
    launchActionId: SessionLaunchActionId,
    description: string,
  ): AgentStudioQuickActionOption => ({
    id,
    role,
    launchActionId,
    label: LAUNCH_ACTION_LABELS[launchActionId],
    description,
    postStartAction: "kickoff",
    disabled: disabledReason !== null,
    ...(disabledReason ? { disabledReason } : {}),
  });

  const options: AgentStudioQuickActionOption[] = [];

  if (params.hasActiveGitConflict && params.roleEnabledByTask.build) {
    options.push({
      ...createLifecycleOption(
        "quick:build_rebase_conflict_resolution",
        "build",
        "build_rebase_conflict_resolution",
        "Ask Builder to resolve the active git conflict.",
      ),
      postStartAction: "send_message",
    });
  }

  if (availableActions.has("set_spec") && params.roleEnabledByTask.spec) {
    options.push(
      createLifecycleOption(
        "quick:spec_initial",
        "spec",
        "spec_initial",
        "Open the start-session flow for the Spec workflow.",
      ),
    );
  }

  if (availableActions.has("set_plan") && params.roleEnabledByTask.planner) {
    options.push(
      createLifecycleOption(
        "quick:planner_initial",
        "planner",
        "planner_initial",
        "Open the start-session flow for the Planner workflow.",
      ),
    );
  }

  if (availableActions.has("build_start") && params.roleEnabledByTask.build) {
    const launchActionId = resolveBuildContinuationLaunchAction(task);
    options.push(
      createLifecycleOption(
        `quick:${launchActionId}`,
        "build",
        launchActionId,
        "Open the start-session flow for Builder implementation work.",
      ),
    );
  }

  if (availableActions.has("qa_start") && params.roleEnabledByTask.qa) {
    options.push(
      createLifecycleOption(
        "quick:qa_review",
        "qa",
        "qa_review",
        "Open the start-session flow for QA review.",
      ),
    );
  }

  if (availableActions.has("human_request_changes") && params.roleEnabledByTask.build) {
    options.push({
      ...createLifecycleOption(
        "quick:build_after_human_request_changes",
        "build",
        "build_after_human_request_changes",
        "Collect human feedback, then open the Builder rework flow.",
      ),
      requiresHumanFeedback: true,
    });
  }

  const builderSessionOptions = buildReusableSessionOptions({
    sessions: params.sessionsForTask.filter((session) => session.taskId === task.id),
    role: "build",
  });
  const hasBuilderSource = builderSessionOptions.length > 0;
  const pullRequestDisabledReason =
    disabledReason ?? (hasBuilderSource ? null : "Requires an existing Builder session.");
  options.push({
    id: "quick:build_pull_request_generation",
    role: "build",
    launchActionId: "build_pull_request_generation",
    label: LAUNCH_ACTION_LABELS.build_pull_request_generation,
    description: "Reuse or fork a Builder session to create or update a pull request.",
    postStartAction: "kickoff",
    disabled: pullRequestDisabledReason !== null,
    ...(pullRequestDisabledReason ? { disabledReason: pullRequestDisabledReason } : {}),
    ...(hasBuilderSource
      ? {
          initialStartMode: getSessionLaunchAction("build_pull_request_generation")
            .defaultStartMode,
          existingSessionOptions: builderSessionOptions,
          initialSourceExternalSessionId: builderSessionOptions[0]?.value ?? null,
        }
      : {}),
  });

  return options;
};

export const selectPrimaryAgentStudioQuickAction = (
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption | null => {
  return options.find((option) => !option.disabled) ?? null;
};
