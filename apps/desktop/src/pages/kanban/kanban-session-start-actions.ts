import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { kickoffPromptForScenario } from "@/features/session-start";
import {
  resolveBuildWorkingDirectoryOverride,
  resolveQaBuilderSessionContext,
} from "@/lib/build-worktree-overrides";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
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
  sessions: AgentSessionState[];
  roleLabels: Record<AgentRole, string>;
  queryClient: QueryClient;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  closeStartModal: () => void;
  openSessionInAgentStudio: (intent: KanbanSessionStartIntent, sessionId: string) => void;
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
};

export const startKanbanSessionFlow = async ({
  activeRepo,
  intent,
  selection,
  startInBackground,
  tasks,
  sessions,
  roleLabels,
  queryClient,
  startAgentSession,
  updateAgentSessionModel,
  humanRequestChangesTask,
  closeStartModal,
  openSessionInAgentStudio,
  sendAgentMessage,
}: StartKanbanSessionFlowInput): Promise<void> => {
  const workingDirectoryOverride = await resolveBuildWorkingDirectoryOverride({
    activeRepo,
    taskId: intent.taskId,
    role: intent.role,
    scenario: intent.scenario,
  });
  const builderContext =
    intent.role === "qa"
      ? await resolveQaBuilderSessionContext({
          activeRepo,
          taskId: intent.taskId,
          sessions,
        })
      : null;
  const sessionId = await startAgentSession({
    taskId: intent.taskId,
    role: intent.role,
    scenario: intent.scenario,
    selectedModel: selection,
    sendKickoff: false,
    startMode: intent.startMode,
    ...(intent.sourceSessionId ? { sourceSessionId: intent.sourceSessionId } : {}),
    requireModelReady: true,
    ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
    ...(builderContext ? { builderContext } : {}),
  });

  if (selection) {
    updateAgentSessionModel(sessionId, selection);
  }

  if (intent.beforeStartAction?.action === "human_request_changes") {
    try {
      await humanRequestChangesTask(intent.taskId, intent.beforeStartAction.note);
    } catch {
      closeStartModal();

      if (startInBackground) {
        const roleLabel = roleLabels[intent.role] ?? intent.role.toUpperCase();
        toast.error(`Started ${roleLabel} session, but requesting changes failed.`, {
          duration: 10000,
          description: renderSessionStartedToastAction(intent, sessionId, openSessionInAgentStudio),
        });
      } else {
        openSessionInAgentStudio(intent, sessionId);
        toast.error("Session started, but requesting changes failed.");
      }

      return;
    }
  }

  closeStartModal();

  if (startInBackground) {
    const roleLabel = roleLabels[intent.role] ?? intent.role.toUpperCase();
    toast.success(`Started ${roleLabel} session in background for ${intent.taskId}.`, {
      duration: 10000,
      description: renderSessionStartedToastAction(intent, sessionId, openSessionInAgentStudio),
    });
  } else {
    openSessionInAgentStudio(intent, sessionId);
  }

  const effectivePostStartAction =
    startInBackground && intent.postStartAction === "none" ? "kickoff" : intent.postStartAction;

  if (effectivePostStartAction === "none") {
    return;
  }

  const buildPostStartMessage = async (): Promise<string> => {
    if (effectivePostStartAction === "send_message") {
      const message = intent.message?.trim() ?? "";
      if (!message) {
        throw new Error("Feedback message is required before sending.");
      }
      return message;
    }

    const promptOverrides = activeRepo
      ? await loadEffectivePromptOverrides(activeRepo, queryClient)
      : undefined;
    const intentTask = tasks.find((entry) => entry.id === intent.taskId);
    const kickoffScenario = assertAgentKickoffScenario(intent.scenario);
    return kickoffPromptForScenario(intent.role, kickoffScenario, intent.taskId, {
      overrides: promptOverrides ?? {},
      task:
        intentTask === undefined
          ? {}
          : {
              title: intentTask.title,
              issueType: intentTask.issueType,
              status: intentTask.status,
              qaRequired: intentTask.aiReviewEnabled,
              description: intentTask.description,
            },
    });
  };

  const failureMessage =
    effectivePostStartAction === "kickoff"
      ? "Session started, but kickoff message failed."
      : "Session started, but feedback message failed.";

  if (startInBackground) {
    try {
      const postStartMessage = await buildPostStartMessage();
      void sendAgentMessage(sessionId, postStartMessage).catch(() => {
        toast.error(failureMessage);
      });
    } catch {
      toast.error(failureMessage);
    }
    return;
  }

  try {
    await sendAgentMessage(sessionId, await buildPostStartMessage());
  } catch {
    toast.error(failureMessage);
  }
};
