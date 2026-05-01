import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentKickoffTemplateId,
  AgentMessageTemplateId,
  AgentRole,
  AgentSessionStartMode,
} from "@openducktor/core";
import { isQaRejectedTask } from "@/lib/task-qa";

export const sessionLaunchActionIds = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_pull_request_generation",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;

export type SessionLaunchActionId = (typeof sessionLaunchActionIds)[number];

export type SessionLaunchAction = {
  id: SessionLaunchActionId;
  role: AgentRole;
  label: string;
  allowedStartModes: readonly AgentSessionStartMode[];
  defaultStartMode: AgentSessionStartMode;
  kickoffTemplateId?: AgentKickoffTemplateId;
  messageTemplateId?: AgentMessageTemplateId;
};

export const SESSION_LAUNCH_ACTIONS = {
  spec_initial: {
    id: "spec_initial",
    role: "spec",
    label: "Spec",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    kickoffTemplateId: "kickoff.spec_initial",
  },
  planner_initial: {
    id: "planner_initial",
    role: "planner",
    label: "Planner",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    kickoffTemplateId: "kickoff.planner_initial",
  },
  build_implementation_start: {
    id: "build_implementation_start",
    role: "build",
    label: "Start Implementation",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    kickoffTemplateId: "kickoff.build_implementation_start",
  },
  build_after_qa_rejected: {
    id: "build_after_qa_rejected",
    role: "build",
    label: "Fix QA Rejection",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    kickoffTemplateId: "kickoff.build_after_qa_rejected",
  },
  build_after_human_request_changes: {
    id: "build_after_human_request_changes",
    role: "build",
    label: "Apply Human Changes",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    kickoffTemplateId: "kickoff.build_after_human_request_changes",
  },
  build_pull_request_generation: {
    id: "build_pull_request_generation",
    role: "build",
    label: "Generate Pull Request",
    allowedStartModes: ["reuse", "fork"],
    defaultStartMode: "reuse",
    kickoffTemplateId: "kickoff.build_pull_request_generation",
  },
  build_rebase_conflict_resolution: {
    id: "build_rebase_conflict_resolution",
    role: "build",
    label: "Resolve Git Conflict",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    messageTemplateId: "message.build_rebase_conflict_resolution",
  },
  qa_review: {
    id: "qa_review",
    role: "qa",
    label: "QA Review",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    kickoffTemplateId: "kickoff.qa_review",
  },
} satisfies Record<SessionLaunchActionId, SessionLaunchAction>;

export const getSessionLaunchAction = (id: SessionLaunchActionId): SessionLaunchAction =>
  SESSION_LAUNCH_ACTIONS[id];

export const getSessionLaunchActionsForRole = (role: AgentRole): SessionLaunchAction[] =>
  sessionLaunchActionIds
    .map((id) => SESSION_LAUNCH_ACTIONS[id])
    .filter((action) => action.role === role);

export const defaultSessionLaunchActionForRole = (role: AgentRole): SessionLaunchActionId => {
  const [action] = getSessionLaunchActionsForRole(role);
  if (!action) {
    throw new Error(`Role "${role}" does not define any launch actions.`);
  }
  return action.id;
};

export const isSessionLaunchActionId = (value: string | null): value is SessionLaunchActionId =>
  value !== null && sessionLaunchActionIds.includes(value as SessionLaunchActionId);

export const isLaunchStartModeAllowed = (
  actionId: SessionLaunchActionId,
  startMode: AgentSessionStartMode,
): boolean =>
  (SESSION_LAUNCH_ACTIONS[actionId] as SessionLaunchAction).allowedStartModes.includes(startMode);

export const resolveBuildContinuationLaunchAction = (
  task: TaskCard | null | undefined,
): SessionLaunchActionId => {
  if (task?.status === "human_review") {
    return "build_after_human_request_changes";
  }
  return isQaRejectedTask(task) ? "build_after_qa_rejected" : "build_implementation_start";
};

export const resolveBuildRequestChangesLaunchAction = (
  _task: TaskCard | null | undefined,
): SessionLaunchActionId => "build_after_human_request_changes";
