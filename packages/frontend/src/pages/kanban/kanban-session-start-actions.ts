import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { toast } from "sonner";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
  SessionStartPostAction,
} from "@/features/session-start";
import { sessionStartPostActionErrorTitle } from "@/features/session-start";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { addTaskToPersistedAgentStudioTabs } from "../agents/agent-studio-task-tabs-storage";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { renderSessionStartedToastAction } from "./session-started-toast-action";

type StartKanbanSessionFlowInput = {
  request: KanbanSessionStartIntent;
  decision: ResolvedSessionStartDecision;
  startInBackground: boolean;
  openAgentStudioTabOnBackgroundSessionStart: boolean;
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

const showPostStartActionError = (action: SessionStartPostAction, error: Error): void => {
  toast.error(sessionStartPostActionErrorTitle(action), {
    description: error.message,
  });
};

export const startKanbanSessionFlow = async ({
  request,
  decision,
  startInBackground,
  openAgentStudioTabOnBackgroundSessionStart,
  tasks,
  roleLabels,
  workspaceId,
  runSessionStartWorkflow,
  humanRequestChangesTask,
  setTaskTargetBranch,
  openSessionInAgentStudio,
}: StartKanbanSessionFlowInput): Promise<AgentSessionIdentity> => {
  const effectivePostStartAction =
    startInBackground && request.postStartAction === "none" ? "kickoff" : request.postStartAction;
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflow = await runSessionStartWorkflow({
    request: {
      ...request,
      postStartAction: effectivePostStartAction,
    },
    decision,
    task,
    ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
    humanRequestChangesTask,
  });
  if (workflow.postStartActionError) {
    showPostStartActionError(effectivePostStartAction, workflow.postStartActionError);
  }

  if (startInBackground) {
    if (openAgentStudioTabOnBackgroundSessionStart) {
      if (!workspaceId) {
        toast.warning("Session started, but Agent Studio tab could not be saved.", {
          description: "No active workspace is selected.",
        });
      } else {
        try {
          addTaskToPersistedAgentStudioTabs({
            workspaceId,
            taskId: request.taskId,
            tasks,
          });
        } catch (error) {
          toast.warning("Session started, but Agent Studio tab could not be saved.", {
            description: error instanceof Error ? error.message : "Unable to update tab storage.",
          });
        }
      }
    }

    const roleLabel = roleLabels[request.role] ?? request.role.toUpperCase();
    toast.success(`Started ${roleLabel} session in background for ${request.taskId}.`, {
      duration: 10000,
      description: renderSessionStartedToastAction(request, workflow, openSessionInAgentStudio),
    });
  } else {
    openSessionInAgentStudio(request, workflow);
  }

  return workflow;
};
