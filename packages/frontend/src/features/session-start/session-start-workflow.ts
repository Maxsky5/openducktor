import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionStartMode,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentMessageSendOptions, AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { StartAgentSession, StartAgentSessionInput } from "@/types/agent-session-start";
import type { SessionLaunchActionId } from "./session-start-launch-options";
import { FEEDBACK_MESSAGE_REQUIRED_ERROR } from "./session-start-prompt-context";
import { resolveSessionStartKickoff } from "./session-start-kickoff";

export type SendAgentMessage = (
  session: AgentSessionIdentity,
  parts: AgentUserMessagePart[],
  options?: AgentMessageSendOptions,
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
  queueIfBusy?: boolean;
  message?: string;
  kickoffPrompt?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartWorkflowResult = AgentSessionIdentity & {
  postStartActionError: Error | null;
  retryPostStartMessage?: () => Promise<void>;
};

type StartSessionWorkflowArgs = {
  isCurrent?: () => boolean;
  queryClient: QueryClient;
  intent: SessionStartWorkflowIntent;
  selection: AgentModelSelection | null;
  task: TaskCard | null;
  workspaceId: string | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
  postStartErrorAttentionId?: string;
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

  const freshRequest: Extract<StartAgentSessionInput, { startMode: "fresh" }> = {
    taskId: intent.taskId,
    role: intent.role,
    startMode: "fresh" as const,
    selectedModel: requireSelectedModel(selection, "fresh"),
    holdForPostStartMessage,
  };
  if (intent.queueIfBusy) {
    freshRequest.queueIfBusy = true;
  }
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

  const baseline = await resolveSessionStartKickoff({ queryClient, intent, task, workspaceId });
  if (intent.kickoffPrompt !== undefined) {
    if (!intent.kickoffPrompt.trim()) throw new Error("Kickoff prompt must not be blank.");
    return intent.kickoffPrompt;
  }
  return baseline;
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
  isCurrent,
  queryClient,
  intent,
  selection,
  task,
  workspaceId,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  postStartErrorAttentionId,
  humanRequestChangesTask,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  const requireCurrentContext = (): void => {
    if (isCurrent && !isCurrent())
      throw new Error("Session start canceled because the selected context changed.");
  };
  requireCurrentContext();
  if (intent.startMode !== "reuse") requireSelectedModel(selection, intent.startMode);
  if (intent.startMode !== "fresh") requireSourceSession(intent.sourceSession, intent.startMode);
  const beforeStartActionArgs: Parameters<typeof runBeforeStartAction>[0] = {
    intent,
    persistTaskTargetBranch,
  };

  if (humanRequestChangesTask) {
    beforeStartActionArgs.humanRequestChangesTask = humanRequestChangesTask;
  }

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

  requireCurrentContext();
  await runBeforeStartAction(beforeStartActionArgs);
  requireCurrentContext();

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
      const parts: AgentUserMessagePart[] = [
        {
          kind: "text",
          text: confirmedPostStartMessage,
        },
      ];
      const sendOptions: AgentMessageSendOptions = {};
      if (intent.postStartAction === "kickoff" && intent.kickoffPrompt !== undefined) {
        sendOptions.preserveTextWhitespace = true;
      }
      if (postStartErrorAttentionId) {
        sendOptions.errorAttentionId = postStartErrorAttentionId;
      }
      if (Object.keys(sendOptions).length > 0) {
        await confirmedPostStartMessageSender(session, parts, sendOptions);
      } else {
        await confirmedPostStartMessageSender(session, parts);
      }
      return null;
    } catch (error) {
      return toError(error);
    }
  };

  const postStartActionError = await runPostStartAction();
  if (!postStartActionError) return { ...session, postStartActionError: null };
  let retryPending = false;
  return {
    ...session,
    postStartActionError,
    retryPostStartMessage: async () => {
      if (retryPending) return;
      retryPending = true;
      try {
        const failure = await runPostStartAction();
        if (failure) throw failure;
      } finally {
        retryPending = false;
      }
    },
  };
};
