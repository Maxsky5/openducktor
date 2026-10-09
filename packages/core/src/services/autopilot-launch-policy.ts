import type { AutopilotActionId, AgentRole, SessionLaunchActionId } from "@openducktor/contracts";
export type AutopilotActionDefinition = {
  id: AutopilotActionId;
  label: string;
  description: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  startPolicy: AutopilotActionStartPolicy;
};

export type AutopilotActionStartPolicy =
  | {
      kind: "launchAction";
    }
  | {
      kind: "latestRoleSession";
    };

export const AUTOPILOT_ACTION_DEFINITIONS = {
  startPlanner: {
    id: "startPlanner",
    label: "Start Planner",
    description:
      "Start the Planner workflow when a task becomes ready for implementation planning.",
    role: "planner",
    launchActionId: "planner_initial",
    startPolicy: { kind: "launchAction" },
  },
  startBuilder: {
    id: "startBuilder",
    label: "Start Builder",
    description: "Start or continue Builder implementation when planning is complete.",
    role: "build",
    launchActionId: "build_implementation_start",
    startPolicy: { kind: "launchAction" },
  },
  startQa: {
    id: "startQa",
    label: "Start QA",
    description: "Start or continue QA review once implementation reaches AI review.",
    role: "qa",
    launchActionId: "qa_review",
    startPolicy: { kind: "launchAction" },
  },
  startReviewQaFeedbacks: {
    id: "startReviewQaFeedbacks",
    label: "Start Review QA Feedbacks",
    description: "Resume Builder to address rejected QA findings at the root cause.",
    role: "build",
    launchActionId: "build_after_qa_rejected",
    startPolicy: { kind: "launchAction" },
  },
  startGeneratePullRequest: {
    id: "startGeneratePullRequest",
    label: "Start Generate Pull Request",
    description: "Fork from the latest Builder session to generate or update the pull request.",
    role: "build",
    launchActionId: "build_pull_request_generation",
    startPolicy: { kind: "latestRoleSession" },
  },
} satisfies Record<AutopilotActionId, AutopilotActionDefinition>;
