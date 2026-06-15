import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionStartMode } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { canonicalTargetBranch, effectiveTaskTargetBranch } from "@/lib/target-branch";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import { loadRepoConfigFromQuery } from "@/state/queries/workspace";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import { executeSessionStart } from "./session-start-execution";
import type { SessionLaunchActionId } from "./session-start-launch-options";
import { getSessionLaunchAction } from "./session-start-launch-options";
import { kickoffPromptForTemplate } from "./session-start-prompts";

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
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartWorkflowResult = AgentSessionIdentity & {
  postStartActionError: Error | null;
};

type StartSessionWorkflowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  queryClient: QueryClient;
  intent: SessionStartWorkflowIntent;
  selection: AgentModelSelection | null;
  task: TaskCard | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage?: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
  postStartExecution?: "await" | "detached";
  onDetachedPostStartError?: ((error: Error) => void) | undefined;
};

const requirePostStartMessage = async ({
  activeWorkspace,
  queryClient,
  intent,
  task,
}: Pick<StartSessionWorkflowArgs, "activeWorkspace" | "queryClient" | "task"> & {
  intent: SessionStartWorkflowIntent;
}): Promise<string> => {
  return buildPostStartMessage({
    activeWorkspace,
    queryClient,
    intent,
    task,
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
}: Pick<
  StartSessionWorkflowArgs,
  "intent" | "selection" | "startAgentSession"
>): Promise<AgentSessionIdentity> => {
  if (intent.startMode === "reuse") {
    return executeSessionStart({
      taskId: intent.taskId,
      role: intent.role,
      startMode: "reuse",
      sourceSession: requireSourceSession(intent.sourceSession, "reuse"),
      startAgentSession,
    });
  }

  if (intent.startMode === "fork") {
    return executeSessionStart({
      taskId: intent.taskId,
      role: intent.role,
      startMode: "fork",
      selectedModel: requireSelectedModel(selection, "fork"),
      sourceSession: requireSourceSession(intent.sourceSession, "fork"),
      startAgentSession,
    });
  }

  const freshRequest = {
    taskId: intent.taskId,
    role: intent.role,
    startMode: "fresh" as const,
    selectedModel: requireSelectedModel(selection, "fresh"),
    startAgentSession,
  };

  if (intent.targetWorkingDirectory !== undefined) {
    return executeSessionStart({
      ...freshRequest,
      targetWorkingDirectory: intent.targetWorkingDirectory,
    });
  }

  return executeSessionStart(freshRequest);
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

const toError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const FEEDBACK_MESSAGE_REQUIRED_ERROR = "Feedback message is required before sending.";

const buildPostStartMessage = async ({
  activeWorkspace,
  queryClient,
  intent,
  task,
}: Pick<StartSessionWorkflowArgs, "activeWorkspace" | "queryClient" | "task"> & {
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
  const humanFeedback =
    kickoffTemplateId === "kickoff.build_after_human_request_changes"
      ? (intent.message?.trim() ?? "")
      : undefined;
  if (kickoffTemplateId === "kickoff.build_after_human_request_changes" && !humanFeedback) {
    throw new Error(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  }
  const promptOverrides = activeWorkspace?.workspaceId
    ? await loadEffectivePromptOverrides(activeWorkspace.workspaceId, queryClient)
    : undefined;
  const repoDefaultTargetBranch = activeWorkspace?.workspaceId
    ? (await loadRepoConfigFromQuery(queryClient, activeWorkspace.workspaceId)).defaultTargetBranch
    : null;
  const git =
    kickoffTemplateId === "kickoff.build_pull_request_generation"
      ? {
          targetBranch: canonicalTargetBranch(
            effectiveTaskTargetBranch(
              intent.targetBranch ?? task?.targetBranch,
              repoDefaultTargetBranch,
            ),
          ),
        }
      : undefined;

  return kickoffPromptForTemplate(intent.role, kickoffTemplateId, intent.taskId, {
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
  activeWorkspace,
  queryClient,
  intent,
  selection,
  task,
  persistTaskTargetBranch,
  startAgentSession,
  settleStartedAgentSession,
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

  const postStartMessageSender =
    intent.postStartAction === "none" ? null : requirePostStartMessageSender(sendAgentMessage);

  const session = await startSessionFromIntent({
    intent,
    selection,
    startAgentSession,
  });

  if (intent.postStartAction === "none") {
    settleStartedAgentSession(session);
    return {
      ...session,
      postStartActionError: null,
    };
  }

  if (!postStartMessageSender) {
    throw new Error("Post-start messaging is unavailable.");
  }

  const confirmedPostStartMessageSender = postStartMessageSender;
  const runPostStartAction = async (): Promise<Error | null> => {
    let postStartMessage: string;
    try {
      postStartMessage = await requirePostStartMessage({
        activeWorkspace,
        queryClient,
        intent,
        task,
      });
    } catch (error) {
      settleStartedAgentSession(session);
      return toError(error);
    }

    try {
      await confirmedPostStartMessageSender(session, [
        {
          kind: "text",
          text: postStartMessage,
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
      ...session,
      postStartActionError: null,
    };
  }

  return {
    ...session,
    postStartActionError: await runPostStartAction(),
  };
};
