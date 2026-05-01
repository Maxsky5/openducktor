import type {
  AutopilotActionId,
  AutopilotEventId,
  AutopilotRule,
  AutopilotSettings,
} from "@openducktor/contracts";
import { AUTOPILOT_EVENT_IDS, createDefaultAutopilotSettings } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { SessionLaunchActionId } from "@/features/session-start/session-start-launch-options";

export const AUTOPILOT_DISABLED_VALUE = "disabled" as const;

export type AutopilotSelectValue = AutopilotActionId | typeof AUTOPILOT_DISABLED_VALUE;

export type AutopilotActionDefinition = {
  id: AutopilotActionId;
  label: string;
  description: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
};

export type AutopilotEventDefinition = {
  id: AutopilotEventId;
  label: string;
  description: string;
  availableActionIds: AutopilotActionId[];
};

export const AUTOPILOT_ACTION_DEFINITIONS: Record<AutopilotActionId, AutopilotActionDefinition> = {
  startPlanner: {
    id: "startPlanner",
    label: "Start Planner",
    description:
      "Start the Planner workflow when a task becomes ready for implementation planning.",
    role: "planner",
    launchActionId: "planner_initial",
  },
  startBuilder: {
    id: "startBuilder",
    label: "Start Builder",
    description: "Start or continue Builder implementation when planning is complete.",
    role: "build",
    launchActionId: "build_implementation_start",
  },
  startQa: {
    id: "startQa",
    label: "Start QA",
    description: "Start or continue QA review once implementation reaches AI review.",
    role: "qa",
    launchActionId: "qa_review",
  },
  startReviewQaFeedbacks: {
    id: "startReviewQaFeedbacks",
    label: "Start Review QA Feedbacks",
    description: "Resume Builder to address rejected QA findings at the root cause.",
    role: "build",
    launchActionId: "build_after_qa_rejected",
  },
  startGeneratePullRequest: {
    id: "startGeneratePullRequest",
    label: "Start Generate Pull Request",
    description: "Fork from the latest Builder session to generate or update the pull request.",
    role: "build",
    launchActionId: "build_pull_request_generation",
  },
};

export const AUTOPILOT_EVENT_DEFINITIONS: AutopilotEventDefinition[] = [
  {
    id: "taskProgressedToSpecReady",
    label: "When a task progresses to Spec Ready",
    description: "Observed when a task first enters `spec_ready` while the app is running.",
    availableActionIds: ["startPlanner"],
  },
  {
    id: "taskProgressedToReadyForDev",
    label: "When a task progresses to Ready for Dev",
    description: "Observed when a task first enters `ready_for_dev` while the app is running.",
    availableActionIds: ["startBuilder"],
  },
  {
    id: "taskProgressedToAiReview",
    label: "When a task progresses to AI Review",
    description: "Observed when a task first enters `ai_review` while the app is running.",
    availableActionIds: ["startQa"],
  },
  {
    id: "taskRejectedByQa",
    label: "When a task is rejected by QA",
    description: "Observed from the canonical QA rejection state while the app is running.",
    availableActionIds: ["startReviewQaFeedbacks"],
  },
  {
    id: "taskProgressedToHumanReview",
    label: "When a task progresses to Human Review",
    description: "Observed when a task first enters `human_review` while the app is running.",
    availableActionIds: ["startGeneratePullRequest"],
  },
];

export const AUTOPILOT_EVENT_DEFINITION_BY_ID: Record<AutopilotEventId, AutopilotEventDefinition> =
  Object.fromEntries(
    AUTOPILOT_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]),
  ) as Record<AutopilotEventId, AutopilotEventDefinition>;

export const getAutopilotRule = (
  settings: AutopilotSettings,
  eventId: AutopilotEventId,
): AutopilotRule => {
  return (
    settings.rules.find((rule) => rule.eventId === eventId) ??
    createDefaultAutopilotSettings().rules.find((rule) => rule.eventId === eventId) ?? {
      eventId,
      actionIds: [],
    }
  );
};

export const getAutopilotSelectedValue = (rule: AutopilotRule): AutopilotSelectValue => {
  return rule.actionIds[0] ?? AUTOPILOT_DISABLED_VALUE;
};

const hasSameActionIds = (
  left: AutopilotRule["actionIds"],
  right: AutopilotRule["actionIds"],
): boolean => {
  return left.length === right.length && left.every((actionId, index) => actionId === right[index]);
};

export const setAutopilotRuleAction = (
  settings: AutopilotSettings,
  eventId: AutopilotEventId,
  value: AutopilotSelectValue,
): AutopilotSettings => {
  const defaultRulesByEvent = new Map<AutopilotEventId, AutopilotRule>(
    createDefaultAutopilotSettings().rules.map((rule) => [rule.eventId, rule]),
  );
  const currentRulesByEvent = new Map<AutopilotEventId, AutopilotRule>(
    settings.rules.map((rule) => [rule.eventId, rule]),
  );
  let hasChanged = false;

  const rules = AUTOPILOT_EVENT_IDS.map((id) => {
    const currentRule = currentRulesByEvent.get(id) ??
      defaultRulesByEvent.get(id) ?? { eventId: id, actionIds: [] };
    if (!currentRulesByEvent.has(id)) {
      hasChanged = true;
    }

    if (id !== eventId) {
      return currentRule;
    }

    const nextActionIds =
      value === AUTOPILOT_DISABLED_VALUE
        ? []
        : [value, ...currentRule.actionIds.filter((actionId) => actionId !== value)];

    if (hasSameActionIds(currentRule.actionIds, nextActionIds)) {
      return currentRule;
    }

    hasChanged = true;

    return {
      eventId: id,
      actionIds: nextActionIds,
    };
  });

  return hasChanged ? { ...settings, rules } : settings;
};
