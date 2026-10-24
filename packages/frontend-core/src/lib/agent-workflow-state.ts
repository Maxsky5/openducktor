import type { AgentWorkflowState } from "@openducktor/contracts";
import {
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
} from "./agent-session-activity-state";
import {
  isQaRejectedTask,
  workflowArtifactRole,
  workflowArtifactVerdict,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type {
  WorkflowStepAttentionVariant,
  WorkflowStepAvailability,
  WorkflowStepLiveSession,
  WorkflowStepPresentation,
  WorkflowStepRailState,
} from "../types/agent-workflow";

/** A review that the role writes has a verdict that does not accept the work. */
const hasFailingReview = (task: TaskCard, role: AgentRole): boolean =>
  Object.entries(task.artifactSummary).some(
    ([code, state]) =>
      state.verdict !== undefined &&
      workflowArtifactRole(code) === role &&
      workflowArtifactVerdict(code, state.verdict)?.passes === false,
  );

export const buildRoleWorkflowState = ({
  task,
  role,
  workflow,
  liveSession,
}: {
  task: TaskCard | null;
  role: AgentRole;
  workflow: AgentWorkflowState;
  liveSession: WorkflowStepLiveSession;
}): WorkflowStepPresentation => {
  const availability = workflowAvailability(workflow);
  const active = isActive(liveSession);
  const qaRejected = isQaRejectedTask(task);
  const taskStatus = task?.status;
  const qaReviewRejected = task?.status === "ai_review" && hasFailingReview(task, role);
  let completion: WorkflowStepPresentation["completion"] = "not_started";

  if (role === "build" && qaRejected) {
    completion = "done";
  } else if (role === "qa" && qaRejected && (taskStatus !== "blocked" || !active)) {
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

type WorkflowRailEntry = {
  role: AgentRole;
  state: WorkflowStepPresentation;
  sessionValue: string | null;
};

/** The hint and attention marker of one workflow rail step. */
export const workflowStepRailState = (entry: WorkflowRailEntry): WorkflowStepRailState => {
  const attentionVariant = workflowStepAttentionVariant(entry);
  return { hint: workflowStepHint(entry, attentionVariant), attentionVariant };
};

const workflowStepAttentionVariant = (entry: WorkflowRailEntry): WorkflowStepAttentionVariant => {
  if (entry.state.liveSession === "waiting_input") {
    return "session_waiting_input";
  }

  if (entry.role === "build" && entry.state.tone === "waiting_input") {
    return "blocked_task";
  }

  return "none";
};

const workflowStepHint = (
  entry: WorkflowRailEntry,
  attentionVariant: WorkflowStepAttentionVariant,
): string => {
  if (attentionVariant === "session_waiting_input") {
    return "Session is waiting for input";
  }
  if (attentionVariant === "blocked_task") {
    return "Task is blocked and waiting for user action";
  }
  if (isWorking(entry.state.liveSession)) {
    return "Step in progress";
  }
  if (entry.state.liveSession === "error") {
    return "Latest session failed";
  }
  if (entry.state.tone === "failed") {
    if (entry.sessionValue) {
      return "Open latest failed session for this role";
    }
    return "Step failed before a session could start";
  }
  if (entry.state.completion === "rejected") {
    return "Latest review rejected this task";
  }
  if (entry.sessionValue) {
    return "Open latest relevant session for this role";
  }
  if (entry.state.tone === "available") {
    return "No session yet for this role";
  }
  if (entry.state.tone === "optional") {
    return "Optional step for this task";
  }
  return "Blocked by workflow state";
};

const workflowAvailability = (workflow: AgentWorkflowState): WorkflowStepAvailability => {
  if (workflow.canSkip && workflow.available) return "optional";
  return workflow.available ? "available" : "blocked";
};

const isWorking = (liveSession: WorkflowStepLiveSession): boolean =>
  liveSession !== "none" && isAgentSessionActivityWorking(liveSession);

const isActive = (liveSession: WorkflowStepLiveSession): boolean =>
  liveSession !== "none" && (isAgentSessionActivityActive(liveSession) || liveSession === "error");

const workflowTone = ({
  availability,
  completion,
  liveSession,
}: Pick<
  WorkflowStepPresentation,
  "availability" | "completion" | "liveSession"
>): WorkflowStepPresentation["tone"] => {
  if (completion === "rejected") return "rejected";
  if (liveSession === "waiting_input") return "waiting_input";
  if (isWorking(liveSession)) return "in_progress";
  if (liveSession === "error") return "failed";
  if (completion === "done") return "done";
  if (completion === "in_progress") return "in_progress";
  return availability;
};
