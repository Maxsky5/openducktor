import type { AgentWorkflows, QaWorkflowVerdict, TaskCard } from "@openducktor/contracts";
import { isReadyForDevOrLater } from "./status-transition-policy";

export const deriveAgentWorkflows = (task: TaskCard): AgentWorkflows => {
  const isFeatureEpic = task.issueType === "feature" || task.issueType === "epic";
  const isTaskBug = task.issueType === "task" || task.issueType === "bug";
  const isClosed = task.status === "closed";
  const readyForDevOrLater = isReadyForDevOrLater(task.status);
  const plannerFeatureEpicStatus = task.status === "spec_ready" || readyForDevOrLater;
  const qaVerdict: QaWorkflowVerdict = task.documentSummary.qaReport.verdict;

  return {
    spec: {
      required: isFeatureEpic,
      canSkip: !isFeatureEpic,
      available: !isClosed,
      completed: task.documentSummary.spec.has,
    },
    planner: {
      required: isFeatureEpic,
      canSkip: !isFeatureEpic,
      available: !isClosed && (isTaskBug || (isFeatureEpic && plannerFeatureEpicStatus)),
      completed: task.documentSummary.plan.has,
    },
    builder: {
      required: true,
      canSkip: false,
      available: !isClosed && (isTaskBug || (isFeatureEpic && readyForDevOrLater)),
      completed:
        task.status === "ai_review" || task.status === "human_review" || task.status === "closed",
    },
    qa: {
      required: task.aiReviewEnabled,
      canSkip: !task.aiReviewEnabled,
      available: !isClosed && (task.status === "ai_review" || task.status === "human_review"),
      completed: qaVerdict === "approved",
    },
  };
};
