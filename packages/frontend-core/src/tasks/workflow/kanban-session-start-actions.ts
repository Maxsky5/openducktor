import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
} from "../../sessions/start/session-start-orchestration";
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
  runSessionStartWorkflow,
  openStartedSession,
  startupAttemptId,
}: StartKanbanSessionFlowInput): Promise<SessionStartWorkflowResult> => {
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
    request,
    decision,
    task,
  };
  if (startupAttemptId) workflowInput.startupAttemptId = startupAttemptId;
  if (isCurrent) workflowInput.isCurrent = isCurrent;
  const workflow = await runSessionStartWorkflow(workflowInput);
  const conflictContextChanged =
    request.launchActionId === "build_rebase_conflict_resolution" && isCurrent && !isCurrent();
  if (!startInBackground && !conflictContextChanged) {
    await openStartedSession(request, workflow);
  }

  return workflow;
};
