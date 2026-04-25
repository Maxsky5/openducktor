import type { TaskCard } from "@openducktor/contracts";
import type { AgentScenario, AgentSessionStartMode } from "@openducktor/core";
import { getAgentScenarioDefinition, isScenarioStartModeAllowed } from "@openducktor/core";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { StartSessionContext, TaskDependencies } from "./start-session.types";

export const resolveStartTask = ({
  ctx,
  task,
}: {
  ctx: StartSessionContext;
  task: TaskDependencies;
}): TaskCard => {
  const resolvedTask = task.taskRef.current.find((entry) => entry.id === ctx.taskId);
  if (!resolvedTask) {
    throw new Error(`Task not found: ${ctx.taskId}`);
  }
  if (!isRoleAvailableForTask(resolvedTask, ctx.role)) {
    throw new Error(unavailableRoleErrorMessage(resolvedTask, ctx.role));
  }
  return resolvedTask;
};

export const assertScenarioStartPolicy = ({
  role,
  scenario,
  startMode,
}: {
  role: StartSessionContext["role"];
  scenario: AgentScenario;
  startMode: AgentSessionStartMode;
}): void => {
  const definition = getAgentScenarioDefinition(scenario);
  if (definition.role !== role) {
    throw new Error(
      `Scenario "${scenario}" belongs to role "${definition.role}", but start was requested for role "${role}".`,
    );
  }
  if (!isScenarioStartModeAllowed(scenario, startMode)) {
    throw new Error(`Scenario "${scenario}" does not allow start mode "${startMode}".`);
  }
};

export const resolveReuseValidationError = ({
  matchesQaTarget,
  matchesBuildTarget,
}: {
  matchesQaTarget: boolean;
  matchesBuildTarget: boolean;
}): string | null => {
  if (!matchesQaTarget) {
    return "it does not match the required builder worktree for this QA session";
  }
  if (!matchesBuildTarget) {
    return "it does not match the current builder continuation target";
  }
  return null;
};
