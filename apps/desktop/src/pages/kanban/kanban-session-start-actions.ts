import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  executeSessionStartFromDecision,
  type ResolvedSessionStartDecision,
} from "@/features/session-start";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { renderSessionStartedToastAction } from "./session-started-toast-action";

type StartKanbanSessionFlowInput = {
  activeWorkspace: ActiveWorkspace | null;
  request: KanbanSessionStartIntent;
  decision: ResolvedSessionStartDecision;
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
  activeWorkspace,
  request,
  decision,
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
    startInBackground && request.postStartAction === "none" ? "kickoff" : request.postStartAction;
  const task = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const workflow = await executeSessionStartFromDecision({
    activeWorkspace,
    queryClient,
    request: {
      ...request,
      postStartAction: effectivePostStartAction,
    },
    decision,
    task,
    ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
    startAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    onPostStartActionError: (action, error) => {
      const failureMessage =
        action === "kickoff"
          ? "Session started, but kickoff message failed."
          : "Session started, but feedback message failed.";
      toast.error(failureMessage, {
        description: error.message,
      });
    },
  });

  if (startInBackground) {
    const roleLabel = roleLabels[request.role] ?? request.role.toUpperCase();
    toast.success(`Started ${roleLabel} session in background for ${request.taskId}.`, {
      duration: 10000,
      description: renderSessionStartedToastAction(
        request,
        workflow.sessionId,
        openSessionInAgentStudio,
      ),
    });
  } else {
    openSessionInAgentStudio(request, workflow.sessionId);
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
