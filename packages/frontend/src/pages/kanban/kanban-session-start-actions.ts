import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { toast } from "sonner";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
} from "@/features/session-start";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

type StartKanbanSessionFlowInput = {
  request: KanbanSessionStartIntent;
  decision: ResolvedSessionStartDecision;
  startInBackground: boolean;
  openAgentStudioTabOnBackgroundSessionStart: boolean;
  tasks: TaskCard[];
  roleLabels: Record<AgentRole, string>;
  workspaceId: string | null;
  saveAgentStudioTab: (taskId: string) => Promise<void>;
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
  decision,
  startInBackground,
  openAgentStudioTabOnBackgroundSessionStart,
  tasks,
  workspaceId,
  saveAgentStudioTab,
  runSessionStartWorkflow,
  humanRequestChangesTask,
  setTaskTargetBranch,
  openSessionInAgentStudio,
}: StartKanbanSessionFlowInput): Promise<AgentSessionIdentity> => {
  const effectivePostStartAction =
    startInBackground && request.postStartAction === "none" ? "kickoff" : request.postStartAction;
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflowInput: Parameters<typeof runSessionStartWorkflow>[0] = {
    request: {
      ...request,
      postStartAction: effectivePostStartAction,
    },
    decision,
    task,
    humanRequestChangesTask,
  };
  if (setTaskTargetBranch) {
    workflowInput.persistTaskTargetBranch = setTaskTargetBranch;
  }
  const workflow = await runSessionStartWorkflow(workflowInput);
  if (startInBackground) {
    if (openAgentStudioTabOnBackgroundSessionStart) {
      if (!workspaceId) {
        toast.warning("Session started, but Agent Studio tab could not be saved.", {
          description: "No active workspace is selected.",
        });
      } else {
        try {
          await saveAgentStudioTab(request.taskId);
        } catch (error) {
          toast.warning("Session started, but Agent Studio tab could not be saved.", {
            description:
              error instanceof Error ? error.message : "Unable to update Agent Studio state.",
          });
        }
      }
    }
  } else {
    openSessionInAgentStudio(request, workflow);
  }

  return workflow;
};
