import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import type { ClientFeedback } from "../../platform/client-feedback";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
} from "../../sessions/start/session-start-orchestration";
import { isSessionStartFailureFeedbackHandled } from "../../sessions/start/session-start-orchestration";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { SessionStartFlowRequest } from "../../sessions/start/session-start-types";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type StartKanbanSessionFlowInput = {
  startupAttemptId?: string;
  request: SessionStartFlowRequest;
  isCurrent?: () => boolean;
  decision: ResolvedSessionStartDecision;
  startInBackground: boolean;
  tasks: TaskCard[];
  workspaceId: string | null;
  feedback: ClientFeedback;
  /** Shows the retry of a first message that did not reach the started session. */
  onPostStartMessageFailure: (result: SessionStartWorkflowResult) => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  openStartedSession: (
    intent: SessionStartFlowRequest,
    session: AgentSessionIdentity,
  ) => void | Promise<void>;
};

export const startKanbanSessionFlow = async ({
  request,
  isCurrent,
  decision,
  startInBackground,
  tasks,
  feedback,
  onPostStartMessageFailure,
  runSessionStartWorkflow,
  openStartedSession,
  startupAttemptId,
}: StartKanbanSessionFlowInput): Promise<SessionStartWorkflowResult> => {
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
    request,
    decision,
    task,
    onPostStartMessageFailure,
  };
  if (startupAttemptId) workflowInput.startupAttemptId = startupAttemptId;
  if (isCurrent) workflowInput.isCurrent = isCurrent;
  const workflow = await runSessionStartWorkflow(workflowInput);
  if (
    workflow.postStartActionError &&
    !workflow.retryPostStartMessage &&
    !isSessionStartFailureFeedbackHandled(workflow.postStartActionError)
  ) {
    feedback.show("error", `Session started, but the first message failed for ${request.taskId}.`, {
      description: workflow.postStartActionError.message,
    });
  }
  const conflictContextChanged =
    request.launchActionId === "build_rebase_conflict_resolution" && isCurrent && !isCurrent();
  if (!startInBackground && !conflictContextChanged) {
    await openStartedSession(request, workflow);
  }

  return workflow;
};
