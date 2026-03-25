import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionStartMode,
} from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import type { AgentStateContextValue } from "@/types/state-slices";
import { executeSessionStart } from "./session-start-execution";
import { kickoffPromptForScenario } from "./session-start-prompts";

export type SessionStartPostAction = "none" | "kickoff" | "send_message";

export type SessionStartBeforeAction = {
  action: "human_request_changes";
  note: string;
};

export type SessionStartWorkflowIntent = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: AgentSessionStartMode;
  sourceSessionId?: string | null;
  postStartAction: SessionStartPostAction;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartWorkflowResult = {
  sessionId: string;
  beforeStartActionError: Error | null;
  postStartActionError: Error | null;
};

type StartSessionWorkflowArgs = {
  activeRepo: string | null;
  queryClient: QueryClient;
  intent: SessionStartWorkflowIntent;
  selection: AgentModelSelection | null;
  task: TaskCard | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage?: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
  postStartExecution?: "await" | "detached";
  onDetachedPostStartError?: ((error: Error) => void) | undefined;
};

const requireSelectedModel = (
  selection: AgentModelSelection | null,
  startMode: "fresh" | "fork",
): AgentModelSelection => {
  if (selection) {
    return selection;
  }
  throw new Error(
    `${startMode === "fork" ? "Fork" : "Fresh"} session start requires a selected model.`,
  );
};

const requireSourceSessionId = (
  sourceSessionId: string | null | undefined,
  startMode: "reuse" | "fork",
): string => {
  if (sourceSessionId) {
    return sourceSessionId;
  }
  throw new Error(
    `${startMode === "fork" ? "Fork" : "Reuse"} session start requires a source session.`,
  );
};

const toError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const buildPostStartMessage = async ({
  activeRepo,
  queryClient,
  intent,
  task,
}: Pick<StartSessionWorkflowArgs, "activeRepo" | "queryClient" | "task"> & {
  intent: SessionStartWorkflowIntent;
}): Promise<string> => {
  if (intent.postStartAction === "send_message") {
    const message = intent.message?.trim() ?? "";
    if (!message) {
      throw new Error("Feedback message is required before sending.");
    }
    return message;
  }

  const kickoffScenario = assertAgentKickoffScenario(intent.scenario);
  const promptOverrides = activeRepo
    ? await loadEffectivePromptOverrides(activeRepo, queryClient)
    : undefined;

  return kickoffPromptForScenario(intent.role, kickoffScenario, intent.taskId, {
    overrides: promptOverrides ?? {},
    task:
      task === null
        ? {}
        : {
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            qaRequired: task.aiReviewEnabled,
            description: task.description,
          },
  });
};

const runBeforeStartAction = async ({
  intent,
  humanRequestChangesTask,
}: Pick<StartSessionWorkflowArgs, "humanRequestChangesTask"> & {
  intent: SessionStartWorkflowIntent;
}): Promise<Error | null> => {
  const beforeStartAction = intent.beforeStartAction;
  if (!beforeStartAction) {
    return null;
  }
  if (!humanRequestChangesTask) {
    throw new Error("Human request changes action is unavailable.");
  }

  try {
    await humanRequestChangesTask(intent.taskId, beforeStartAction.note);
    return null;
  } catch (error) {
    return toError(error);
  }
};

export const startSessionWorkflow = async ({
  activeRepo,
  queryClient,
  intent,
  selection,
  task,
  startAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  postStartExecution = "await",
  onDetachedPostStartError,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  const sessionId =
    intent.startMode === "reuse"
      ? await executeSessionStart({
          taskId: intent.taskId,
          role: intent.role,
          scenario: intent.scenario,
          startMode: "reuse",
          sourceSessionId: requireSourceSessionId(intent.sourceSessionId, "reuse"),
          startAgentSession,
        })
      : intent.startMode === "fork"
        ? await executeSessionStart({
            taskId: intent.taskId,
            role: intent.role,
            scenario: intent.scenario,
            startMode: "fork",
            selectedModel: requireSelectedModel(selection, "fork"),
            sourceSessionId: requireSourceSessionId(intent.sourceSessionId, "fork"),
            startAgentSession,
          })
        : await executeSessionStart({
            taskId: intent.taskId,
            role: intent.role,
            scenario: intent.scenario,
            startMode: "fresh",
            selectedModel: requireSelectedModel(selection, "fresh"),
            startAgentSession,
          });

  const beforeStartActionError = await runBeforeStartAction({
    intent,
    ...(humanRequestChangesTask ? { humanRequestChangesTask } : {}),
  });

  if (beforeStartActionError || intent.postStartAction === "none") {
    return {
      sessionId,
      beforeStartActionError,
      postStartActionError: null,
    };
  }
  if (!sendAgentMessage) {
    throw new Error("Post-start messaging is unavailable.");
  }

  const runPostStartAction = async (): Promise<Error | null> => {
    try {
      await sendAgentMessage(
        sessionId,
        await buildPostStartMessage({
          activeRepo,
          queryClient,
          intent,
          task,
        }),
      );
      return null;
    } catch (error) {
      return toError(error);
    }
  };

  if (postStartExecution === "detached") {
    void runPostStartAction().then((error) => {
      if (error) {
        onDetachedPostStartError?.(error);
      }
    });
    return {
      sessionId,
      beforeStartActionError: null,
      postStartActionError: null,
    };
  }

  return {
    sessionId,
    beforeStartActionError: null,
    postStartActionError: await runPostStartAction(),
  };
};
