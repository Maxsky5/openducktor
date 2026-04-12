import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { startSessionWorkflow } from "@/features/session-start";
import type { AgentStateContextValue } from "@/types/state-slices";
import type {
  KanbanResolvedSessionStartIntent,
  KanbanSessionStartIntent,
} from "./kanban-page-model-types";
import { renderSessionStartedToastAction } from "./session-started-toast-action";

type StartKanbanSessionFlowInput = {
  activeRepo: string | null;
  intent: KanbanResolvedSessionStartIntent;
  selection: AgentModelSelection | null;
  startInBackground: boolean;
  tasks: TaskCard[];
  roleLabels: Record<AgentRole, string>;
  queryClient: QueryClient;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (
    taskId: string,
    targetBranch: import("@openducktor/contracts").GitTargetBranch,
  ) => Promise<void>;
  openSessionInAgentStudio: (intent: KanbanSessionStartIntent, sessionId: string) => void;
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
};

export const startKanbanSessionFlow = async ({
  activeRepo,
  intent,
  selection,
  startInBackground,
  tasks,
  roleLabels,
  queryClient,
  startAgentSession,
  humanRequestChangesTask,
  setTaskTargetBranch,
  openSessionInAgentStudio,
  sendAgentMessage,
}: StartKanbanSessionFlowInput): Promise<string> => {
  const effectivePostStartAction =
    startInBackground && intent.postStartAction === "none" ? "kickoff" : intent.postStartAction;
  const task = tasks.find((entry) => entry.id === intent.taskId) ?? null;
  const workflow = await startSessionWorkflow({
    activeRepo,
    queryClient,
    intent: {
      ...intent,
      postStartAction: effectivePostStartAction,
    },
    selection,
    task,
    ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
    startAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    postStartExecution: effectivePostStartAction === "none" ? "await" : "detached",
    onDetachedPostStartError: (error) => {
      const failureMessage =
        effectivePostStartAction === "kickoff"
          ? "Session started, but kickoff message failed."
          : "Session started, but feedback message failed.";
      toast.error(failureMessage, {
        description: error.message,
      });
    },
  });

  if (startInBackground) {
    const roleLabel = roleLabels[intent.role] ?? intent.role.toUpperCase();
    toast.success(`Started ${roleLabel} session in background for ${intent.taskId}.`, {
      duration: 10000,
      description: renderSessionStartedToastAction(
        intent,
        workflow.sessionId,
        openSessionInAgentStudio,
      ),
    });
  } else {
    openSessionInAgentStudio(intent, workflow.sessionId);
  }

  if (effectivePostStartAction === "none") {
    return workflow.sessionId;
  }

  if (workflow.postStartActionError) {
    const failureMessage =
      effectivePostStartAction === "kickoff"
        ? "Session started, but kickoff message failed."
        : "Session started, but feedback message failed.";
    toast.error(failureMessage, {
      description: workflow.postStartActionError.message,
    });
  }

  return workflow.sessionId;
};
