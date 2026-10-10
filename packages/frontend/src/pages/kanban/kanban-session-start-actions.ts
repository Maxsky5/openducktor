import type { TaskCard } from "@openducktor/contracts";
import type { SessionStartWorkflowResult } from "@/features/session-start";
import { showSessionStartMessageRecovery } from "@/features/session-start/session-start-message-recovery";
import type { AgentRole } from "@openducktor/core";
import { toast } from "sonner";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
} from "@/features/session-start";
import { isSessionStartFailureFeedbackHandled } from "@/features/session-start/session-start-orchestration";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

type StartKanbanSessionFlowInput = {
  request: KanbanSessionStartIntent;
  isCurrent?: () => boolean;
  decision: ResolvedSessionStartDecision;
  startInBackground: boolean;
  tasks: TaskCard[];
  roleLabels: Record<AgentRole, string>;
  workspaceId: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  openSessionInAgentStudio: (
    intent: KanbanSessionStartIntent,
    session: AgentSessionIdentity,
  ) => void;
};

export const startKanbanSessionFlow = async ({
  request,
  isCurrent,
  decision,
  startInBackground,
  tasks,
  runSessionStartWorkflow,
  openSessionInAgentStudio,
}: StartKanbanSessionFlowInput): Promise<SessionStartWorkflowResult> => {
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
    request,
    decision,
    task,
    onPostStartMessageFailure: showSessionStartMessageRecovery,
  };
  if (isCurrent) workflowInput.isCurrent = isCurrent;
  const workflow = await runSessionStartWorkflow(workflowInput);
  if (
    workflow.postStartActionError &&
    !workflow.retryPostStartMessage &&
    !isSessionStartFailureFeedbackHandled(workflow.postStartActionError)
  ) {
    toast.error(`Session started, but the first message failed for ${request.taskId}.`, {
      description: workflow.postStartActionError.message,
    });
  }
  const conflictContextChanged =
    request.launchActionId === "build_rebase_conflict_resolution" && isCurrent && !isCurrent();
  if (!startInBackground && !conflictContextChanged) {
    openSessionInAgentStudio(request, workflow);
  }

  return workflow;
};
