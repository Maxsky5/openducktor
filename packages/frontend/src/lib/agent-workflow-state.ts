import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import { isQaRejectedTask } from "@/lib/task-qa";
import type {
  AgentWorkflowStepAvailability,
  AgentWorkflowStepLiveSession,
  AgentWorkflowStepState,
} from "@/types/agent-workflow";

export const buildRoleWorkflowState = ({
  task,
  role,
  workflow,
  liveSession,
}: {
  task: TaskCard | null;
  role: AgentRole;
  workflow: AgentWorkflowState;
  liveSession: AgentWorkflowStepLiveSession;
}): AgentWorkflowStepState => {
  const availability = workflowAvailability(workflow);
  const active = isActive(liveSession);
  const qaRejected = isQaRejectedTask(task);
  const taskStatus = task?.status;
  const qaApproved =
    task?.documentSummary.qaReport.verdict === "approved" &&
    (taskStatus === "ai_review" || taskStatus === "human_review" || taskStatus === "closed");
  const qaReviewRejected =
    task?.status === "ai_review" && task.documentSummary.qaReport.verdict === "rejected";
  let completion: AgentWorkflowStepState["completion"] = "not_started";

  if (role === "build" && (qaRejected || qaApproved)) {
    completion = "done";
  } else if (role === "qa" && qaRejected) {
    completion = "rejected";
  } else if (role === "qa" && qaReviewRejected && !active) {
    completion = "rejected";
  } else if (workflow.completed) {
    completion = "done";
  } else if (
    active ||
    (liveSession === "idle" && workflow.available) ||
    (role === "build" && liveSession === "stopped" && workflow.available)
  ) {
    completion = "in_progress";
  }

  const blockedBuild =
    role === "build" &&
    taskStatus === "blocked" &&
    !isWorking(liveSession) &&
    liveSession !== "error";
  return {
    tone: blockedBuild ? "waiting_input" : workflowTone({ availability, completion, liveSession }),
    availability,
    completion,
    liveSession,
  };
};

const workflowAvailability = (workflow: AgentWorkflowState): AgentWorkflowStepAvailability => {
  if (workflow.canSkip && workflow.available) return "optional";
  return workflow.available ? "available" : "blocked";
};

const isWorking = (liveSession: AgentWorkflowStepLiveSession): boolean =>
  liveSession !== "none" && isAgentSessionActivityWorking(liveSession);

const isActive = (liveSession: AgentWorkflowStepLiveSession): boolean =>
  liveSession !== "none" && (isAgentSessionActivityActive(liveSession) || liveSession === "error");

const workflowTone = ({
  availability,
  completion,
  liveSession,
}: Pick<
  AgentWorkflowStepState,
  "availability" | "completion" | "liveSession"
>): AgentWorkflowStepState["tone"] => {
  if (completion === "rejected") return "rejected";
  if (liveSession === "waiting_input") return "waiting_input";
  if (isWorking(liveSession)) return "in_progress";
  if (liveSession === "error") return "failed";
  if (completion === "done") return "done";
  if (completion === "in_progress") return "in_progress";
  return availability;
};
