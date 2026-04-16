import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionStartMode,
} from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { canonicalTargetBranch, effectiveTaskTargetBranch } from "@/lib/target-branch";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import { loadRepoConfigFromQuery } from "@/state/queries/workspace";
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
  targetBranch?: GitTargetBranch;
  targetWorkingDirectory?: string | null;
  postStartAction: SessionStartPostAction;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartWorkflowResult = {
  sessionId: string;
  postStartActionError: Error | null;
};

type StartSessionWorkflowArgs = {
  activeRepo: string | null;
  queryClient: QueryClient;
  intent: SessionStartWorkflowIntent;
  selection: AgentModelSelection | null;
  task: TaskCard | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
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

const FEEDBACK_MESSAGE_REQUIRED_ERROR = "Feedback message is required before sending.";

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
      throw new Error(FEEDBACK_MESSAGE_REQUIRED_ERROR);
    }
    return message;
  }

  const kickoffScenario = assertAgentKickoffScenario(intent.scenario);
  const humanFeedback =
    kickoffScenario === "build_after_human_request_changes"
      ? (intent.message?.trim() ?? "")
      : undefined;
  if (kickoffScenario === "build_after_human_request_changes" && !humanFeedback) {
    throw new Error(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  }
  const promptOverrides = activeRepo
    ? await loadEffectivePromptOverrides(activeRepo, queryClient)
    : undefined;
  const repoDefaultTargetBranch = activeRepo
    ? (await loadRepoConfigFromQuery(queryClient, activeRepo)).defaultTargetBranch
    : null;
  const git =
    kickoffScenario === "build_pull_request_generation"
      ? {
          targetBranch: canonicalTargetBranch(
            effectiveTaskTargetBranch(
              intent.targetBranch ?? task?.targetBranch,
              repoDefaultTargetBranch,
            ),
          ),
        }
      : undefined;

  return kickoffPromptForScenario(intent.role, kickoffScenario, intent.taskId, {
    overrides: promptOverrides ?? {},
    ...(humanFeedback
      ? {
          extraPlaceholders: {
            humanFeedback,
          },
        }
      : {}),
    ...(git ? { git } : {}),
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
  persistTaskTargetBranch,
}: Pick<StartSessionWorkflowArgs, "humanRequestChangesTask"> & {
  persistTaskTargetBranch?: StartSessionWorkflowArgs["persistTaskTargetBranch"];
  intent: SessionStartWorkflowIntent;
}): Promise<void> => {
  const beforeStartAction = intent.beforeStartAction;
  if (!beforeStartAction) {
    if (!intent.targetBranch || !persistTaskTargetBranch) {
      return;
    }

    await persistTaskTargetBranch(intent.taskId, intent.targetBranch);
    return;
  }
  if (!humanRequestChangesTask) {
    throw new Error("Human request changes action is unavailable.");
  }

  await humanRequestChangesTask(intent.taskId, beforeStartAction.note);

  if (intent.targetBranch && persistTaskTargetBranch) {
    await persistTaskTargetBranch(intent.taskId, intent.targetBranch);
  }
};

export const startSessionWorkflow = async ({
  activeRepo,
  queryClient,
  intent,
  selection,
  task,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  postStartExecution = "await",
  onDetachedPostStartError,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  await runBeforeStartAction({
    intent,
    persistTaskTargetBranch,
    ...(humanRequestChangesTask ? { humanRequestChangesTask } : {}),
  });

  const sessionId =
    intent.startMode === "reuse"
      ? await executeSessionStart({
          taskId: intent.taskId,
          role: intent.role,
          scenario: intent.scenario,
          startMode: "reuse",
          sourceSessionId: requireSourceSessionId(intent.sourceSessionId, "reuse"),
          ...(intent.targetBranch !== undefined
            ? { kickoffTargetBranch: intent.targetBranch }
            : {}),
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
            ...(intent.targetBranch !== undefined
              ? { kickoffTargetBranch: intent.targetBranch }
              : {}),
            startAgentSession,
          })
        : await executeSessionStart({
            taskId: intent.taskId,
            role: intent.role,
            scenario: intent.scenario,
            startMode: "fresh",
            selectedModel: requireSelectedModel(selection, "fresh"),
            ...(intent.targetBranch !== undefined
              ? { kickoffTargetBranch: intent.targetBranch }
              : {}),
            ...(intent.targetWorkingDirectory !== undefined
              ? { targetWorkingDirectory: intent.targetWorkingDirectory }
              : {}),
            startAgentSession,
          });

  if (intent.postStartAction === "none") {
    return {
      sessionId,
      postStartActionError: null,
    };
  }
  if (!sendAgentMessage) {
    throw new Error("Post-start messaging is unavailable.");
  }

  const runPostStartAction = async (): Promise<Error | null> => {
    try {
      await sendAgentMessage(sessionId, [
        {
          kind: "text",
          text: await buildPostStartMessage({
            activeRepo,
            queryClient,
            intent,
            task,
          }),
        },
      ]);
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
      postStartActionError: null,
    };
  }

  return {
    sessionId,
    postStartActionError: await runPostStartAction(),
  };
};
