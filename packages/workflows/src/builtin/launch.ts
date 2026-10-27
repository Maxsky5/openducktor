import type { BuiltinTaskCard } from "./task-card";
import type { AgentKickoffTemplateId } from "./agent-prompts";
import {
  BUILTIN_ACTIONS,
  BUILTIN_STATES,
  BUILTIN_STEPS,
  builtinWorkflow,
  type BuiltinLaunchAction,
  type BuiltinTaskEventId,
} from "./definition";
import { cachedByTaskInput } from "./facts";
import { buildRoleWorkflowMapForTask } from "./presentation-role-state";
import {
  BUILTIN_ROLE_IDS,
  type BuiltinActionId,
  type BuiltinLaunchActionId,
  type BuiltinRoleId,
} from "./ids";

export type KickoffPromptContextKind = "none" | "human_feedback" | "pull_request";

const startEvents = new Map<BuiltinRoleId, BuiltinTaskEventId>(
  BUILTIN_STEPS.flatMap((step) =>
    "startEventId" in step ? [[step.roleId, step.startEventId] as const] : [],
  ),
);

/** The event that a session start of the role must admit and that its startup sends. */
export const roleStartEvent = (role: BuiltinRoleId): BuiltinTaskEventId | undefined =>
  startEvents.get(role);

/** A launch action of the definition, with the role of its step. */
export type SessionLaunchAction = BuiltinLaunchAction & { role: BuiltinRoleId };

/** All launch actions, in step order. */
export const SESSION_LAUNCH_ACTIONS: readonly SessionLaunchAction[] = BUILTIN_STEPS.flatMap(
  (step) => step.launchActions.map((launch) => ({ ...launch, role: step.roleId })),
);
const launchActionsById = new Map<string, SessionLaunchAction>(
  SESSION_LAUNCH_ACTIONS.map((action) => [action.id, action]),
);

export const getSessionLaunchAction = (id: string): SessionLaunchAction => {
  const action = launchActionsById.get(id);
  if (!action) throw new Error(`The built-in workflow has no launch action ${id}.`);
  return action;
};

const promptContextByKickoff = new Map<string, KickoffPromptContextKind>(
  SESSION_LAUNCH_ACTIONS.flatMap((action) =>
    action.template.kind === "kickoff"
      ? [[action.template.id, action.context ?? "none"] as const]
      : [],
  ),
);

/** The extra prompt context that the launch action of a kickoff template needs. */
export const kickoffPromptContextKind = (
  templateId: AgentKickoffTemplateId,
): KickoffPromptContextKind => promptContextByKickoff.get(templateId) ?? "none";

const stepByRole = new Map(BUILTIN_STEPS.map((step) => [step.roleId, step]));
const roleStep = (role: BuiltinRoleId) => {
  const step = stepByRole.get(role);
  if (!step) throw new Error(`The built-in workflow has no step for role ${role}.`);
  return step;
};

export const defaultSessionLaunchActionForRole = (role: BuiltinRoleId): BuiltinLaunchActionId => {
  const [launch] = roleStep(role).launchActions;
  if (!launch) throw new Error(`Role "${role}" does not define any launch actions.`);
  return launch.id;
};

const stepContinuations = new Map(
  BUILTIN_STEPS.map((step) => [
    step.roleId,
    cachedByTaskInput((input) => builtinWorkflow.stepLaunchAction(input, step.id)),
  ]),
);

/** The launch action that continues the role step of a task. Without a task, the first one. */
export const resolveSessionContinuationLaunchAction = (
  role: BuiltinRoleId,
  task: BuiltinTaskCard | null | undefined,
): BuiltinLaunchActionId => {
  const continuation = stepContinuations.get(role);
  if (!task || !continuation) return defaultSessionLaunchActionForRole(role);
  return continuation(task);
};

const actionLaunches = new Map(
  BUILTIN_ACTIONS.flatMap((action) =>
    "launchActionIds" in action
      ? [
          [
            action.id,
            cachedByTaskInput((input) => builtinWorkflow.actionLaunchAction(input, action.id)),
          ] as const,
        ]
      : [],
  ),
);

/** The launch action that an action starts for a task. */
export const resolveActionLaunchAction = (
  action: BuiltinActionId,
  task: BuiltinTaskCard,
): BuiltinLaunchActionId => {
  const launch = actionLaunches.get(action);
  if (launch === undefined) throw new Error(`The built-in action ${action} starts no session.`);
  return launch(task);
};

export const supportsTaskTargetBranchSelection = (
  role: string | null | undefined,
  launchActionId: BuiltinLaunchActionId | null | undefined,
): boolean => {
  if (launchActionId === undefined || launchActionId === null) return false;
  const action = getSessionLaunchAction(launchActionId);
  return action.role === role && action.targetBranch === true;
};

const stateStudioRoles = new Map(BUILTIN_STATES.map((state) => [state.id, state.studioRole]));

/** The state role, else the first role whose step is required and available. */
export const resolveAgentStudioDefaultRoleForTask = (
  task: BuiltinTaskCard | null,
): BuiltinRoleId | null => {
  if (!task) return null;
  const studioRole = stateStudioRoles.get(task.status);
  if (studioRole !== undefined) return studioRole;
  const roleWorkflowMap = buildRoleWorkflowMapForTask(task);
  return (
    BUILTIN_ROLE_IDS.find(
      (role) => roleWorkflowMap[role].required && roleWorkflowMap[role].available,
    ) ?? null
  );
};
