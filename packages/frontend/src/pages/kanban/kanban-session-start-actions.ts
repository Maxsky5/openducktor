import { showSessionStartMessageRecovery } from "@/features/session-start/session-start-message-recovery";
import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
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
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
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
  humanRequestChangesTask,
  setTaskTargetBranch,
  openSessionInAgentStudio,
}: StartKanbanSessionFlowInput): Promise<AgentSessionIdentity> => {
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
    request,
    decision,
    task,
    humanRequestChangesTask,
    onPostStartMessageFailure: showSessionStartMessageRecovery,
  };
  if (isCurrent) workflowInput.isCurrent = isCurrent;
  if (setTaskTargetBranch) {
    workflowInput.persistTaskTargetBranch = setTaskTargetBranch;
  }
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
  if (!startInBackground) {
    openSessionInAgentStudio(request, workflow);
  }

  return workflow;
};
