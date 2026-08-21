import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionStartMode,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import { loadRepoConfigFromQuery } from "@/state/queries/workspace";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { StartAgentSession } from "@/types/agent-session-start";
import type { SessionLaunchActionId } from "./session-start-launch-options";
import { getSessionLaunchAction } from "./session-start-launch-options";
import {
  FEEDBACK_MESSAGE_REQUIRED_ERROR,
  resolveSessionStartKickoffPromptContext,
} from "./session-start-prompt-context";
import { kickoffPromptForTemplate } from "./session-start-prompts";

export type SendAgentMessage = (
  session: AgentSessionIdentity,
  parts: AgentUserMessagePart[],
) => Promise<void>;

export type SessionStartPostAction = "none" | "kickoff" | "send_message";

export type SessionStartBeforeAction = {
  action: "human_request_changes";
  note: string;
};

export type SessionStartWorkflowIntent = {
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  startMode: AgentSessionStartMode;
  sourceSession?: AgentSessionIdentity | null;
  targetBranch?: GitTargetBranch;
  targetWorkingDirectory?: string | null;
  postStartAction: SessionStartPostAction;
  holdForPostStartMessage?: boolean;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartWorkflowResult = AgentSessionIdentity & {
  postStartActionError: Error | null;
};

type StartSessionWorkflowArgs = {
  queryClient: QueryClient;
  intent: SessionStartWorkflowIntent;
  selection: AgentModelSelection | null;
  task: TaskCard | null;
  workspaceId: string | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
};

const requirePostStartMessage = async ({
  queryClient,
  intent,
  task,
  workspaceId,
}: Pick<StartSessionWorkflowArgs, "queryClient" | "task" | "workspaceId"> & {
  intent: SessionStartWorkflowIntent;
}): Promise<string> => {
  return buildPostStartMessage({
    queryClient,
    intent,
    task,
    workspaceId,
  });
};

const requirePostStartMessageSender = (
  sendAgentMessage: StartSessionWorkflowArgs["sendAgentMessage"],
): NonNullable<StartSessionWorkflowArgs["sendAgentMessage"]> => {
  if (!sendAgentMessage) {
    throw new Error("Post-start messaging is unavailable.");
  }

  return sendAgentMessage;
};

const startSessionFromIntent = ({
  intent,
  selection,
  startAgentSession,
  holdForPostStartMessage,
}: Pick<StartSessionWorkflowArgs, "intent" | "selection" | "startAgentSession"> & {
  holdForPostStartMessage: boolean;
}): Promise<AgentSessionIdentity> => {
  if (intent.startMode === "reuse") {
    return startAgentSession({
      taskId: intent.taskId,
      role: intent.role,
      startMode: "reuse",
      sourceSession: requireSourceSession(intent.sourceSession, "reuse"),
    });
  }

  if (intent.startMode === "fork") {
    return startAgentSession({
      taskId: intent.taskId,
      role: intent.role,
      startMode: "fork",
      selectedModel: requireSelectedModel(selection, "fork"),
      sourceSession: requireSourceSession(intent.sourceSession, "fork"),
      holdForPostStartMessage,
    });
  }

  const freshRequest = {
    taskId: intent.taskId,
    role: intent.role,
    startMode: "fresh" as const,
    selectedModel: requireSelectedModel(selection, "fresh"),
    holdForPostStartMessage,
  };

  if (intent.targetWorkingDirectory !== undefined) {
    return startAgentSession({
      ...freshRequest,
      targetWorkingDirectory: intent.targetWorkingDirectory,
    });
  }

  return startAgentSession(freshRequest);
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

const requireSourceSession = (
  sourceSession: AgentSessionIdentity | null | undefined,
  startMode: "reuse" | "fork",
): AgentSessionIdentity => {
  if (sourceSession) {
    return sourceSession;
  }
  throw new Error(
    `${startMode === "fork" ? "Fork" : "Reuse"} session start requires a source session.`,
  );
};

const toError = (cause: unknown): Error => {
  return cause instanceof Error ? cause : new Error(String(cause));
};

const buildPostStartMessage = async ({
  queryClient,
  intent,
  task,
  workspaceId,
}: Pick<StartSessionWorkflowArgs, "queryClient" | "task" | "workspaceId"> & {
  intent: SessionStartWorkflowIntent;
}): Promise<string> => {
  if (intent.postStartAction === "send_message") {
    const message = intent.message?.trim() ?? "";
    if (!message) {
      throw new Error(FEEDBACK_MESSAGE_REQUIRED_ERROR);
    }
    return message;
  }

  const launchAction = getSessionLaunchAction(intent.launchActionId);
  const kickoffTemplateId = launchAction.kickoffTemplateId;
  if (!kickoffTemplateId) {
    throw new Error(`Launch action "${intent.launchActionId}" does not define a kickoff prompt.`);
  }
  const promptOverrides = workspaceId
    ? await loadEffectivePromptOverrides(workspaceId, queryClient)
    : undefined;
  const taskTargetBranch = intent.targetBranch ?? task?.targetBranch;
  const promptContext = await resolveSessionStartKickoffPromptContext({
    templateId: kickoffTemplateId,
    ...(intent.message === undefined ? {} : { message: intent.message }),
    ...(taskTargetBranch ? { taskTargetBranch } : {}),
    loadRepoDefaultTargetBranch: async () => {
      if (!workspaceId) {
        return null;
      }
      return (await loadRepoConfigFromQuery(queryClient, workspaceId)).defaultTargetBranch;
    },
  });

  return kickoffPromptForTemplate(intent.role, kickoffTemplateId, intent.taskId, {
    overrides: promptOverrides ?? {},
    ...promptContext,
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
  queryClient,
  intent,
  selection,
  task,
  workspaceId,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  await runBeforeStartAction({
    intent,
    persistTaskTargetBranch,
    ...(humanRequestChangesTask ? { humanRequestChangesTask } : {}),
  });

  const postStartMessageSender =
    intent.postStartAction === "none" ? null : requirePostStartMessageSender(sendAgentMessage);
  const postStartMessage =
    intent.postStartAction === "none"
      ? null
      : await requirePostStartMessage({
          queryClient,
          intent,
          task,
          workspaceId,
        });

  const session = await startSessionFromIntent({
    intent,
    selection,
    startAgentSession,
    holdForPostStartMessage: postStartMessage !== null || intent.holdForPostStartMessage === true,
  });

  if (intent.postStartAction === "none") {
    return {
      ...session,
      postStartActionError: null,
    };
  }

  if (!postStartMessageSender) {
    throw new Error("Post-start messaging is unavailable.");
  }
  if (postStartMessage === null) {
    throw new Error("Post-start message is unavailable.");
  }

  const confirmedPostStartMessageSender = postStartMessageSender;
  const confirmedPostStartMessage = postStartMessage;
  const runPostStartAction = async (): Promise<Error | null> => {
    try {
      await confirmedPostStartMessageSender(session, [
        {
          kind: "text",
          text: confirmedPostStartMessage,
        },
      ]);
      return null;
    } catch (error) {
      return toError(error);
    }
  };

  return {
    ...session,
    postStartActionError: await runPostStartAction(),
  };
};
