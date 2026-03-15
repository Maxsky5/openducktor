import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import { toast } from "sonner";
import { kickoffPromptForScenario } from "@/features/session-start";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { renderSessionStartedToastAction } from "./session-started-toast-action";

export type RequestChangesBuildScenario =
  | "build_after_human_request_changes"
  | "build_after_qa_rejected";

export const toPromptTaskContext = (task: TaskCard | undefined) => {
  if (!task) {
    return {};
  }

  return {
    title: task.title,
    issueType: task.issueType,
    status: task.status,
    qaRequired: task.aiReviewEnabled,
    description: task.description,
  };
};

export const resolveRequestChangesScenario = (
  task: TaskCard | undefined,
): RequestChangesBuildScenario => {
  return task?.status === "human_review"
    ? "build_after_human_request_changes"
    : "build_after_qa_rejected";
};

export const buildHumanReviewMessage = (
  task: TaskCard | undefined,
  taskId: string,
  scenario: RequestChangesBuildScenario,
): string => {
  return kickoffPromptForScenario("build", scenario, taskId, {
    task: toPromptTaskContext(task),
  });
};

type StartKanbanSessionFlowInput = {
  activeRepo: string | null;
  intent: KanbanSessionStartIntent;
  selection: AgentModelSelection | null;
  startInBackground: boolean;
  tasks: TaskCard[];
  roleLabels: Record<AgentRole, string>;
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
  roleLabels,
  startAgentSession,
  updateAgentSessionModel,
  humanRequestChangesTask,
  closeStartModal,
  openSessionInAgentStudio,
  sendAgentMessage,
}: StartKanbanSessionFlowInput): Promise<void> => {
  const sessionId = await startAgentSession({
    taskId: intent.taskId,
    role: intent.role,
    scenario: intent.scenario,
    selectedModel: selection,
    sendKickoff: false,
    startMode: intent.startMode,
    requireModelReady: true,
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

    const promptOverrides = activeRepo ? await loadEffectivePromptOverrides(activeRepo) : undefined;
    const intentTask = tasks.find((entry) => entry.id === intent.taskId);
    const kickoffScenario = assertAgentKickoffScenario(intent.scenario);
    return kickoffPromptForScenario(intent.role, kickoffScenario, intent.taskId, {
      overrides: promptOverrides ?? {},
      task: toPromptTaskContext(intentTask),
    });
  };

  const failureMessage =
    effectivePostStartAction === "kickoff"
      ? "Session started, but kickoff message failed."
      : "Session started, but feedback message failed.";

  if (startInBackground) {
    void (async () => {
      try {
        await sendAgentMessage(sessionId, await buildPostStartMessage());
      } catch {
        toast.error(failureMessage);
      }
    })();
    return;
  }

  try {
    await sendAgentMessage(sessionId, await buildPostStartMessage());
  } catch {
    toast.error(failureMessage);
  }
};
