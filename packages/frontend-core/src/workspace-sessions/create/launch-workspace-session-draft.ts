import type {
  StartupOwnership,
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import type { ClientConnection } from "../../connection/client-connection";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
} from "../../drafts/agent-chat-composer-draft";
import { workspaceSessionDraftTitle } from "../../drafts/new-workspace-session-draft-store";
import { invalidateRepoBranchesQuery } from "../../queries/git";
import { invalidateTerminalList } from "../../queries/terminals";
import { workspaceSessionWorktreesQueryOptions } from "../../queries/workspace-sessions";
import type { AgentSessionsStore } from "../../sessions/agent-sessions-store";
import { requireSystemCommandSessionTarget } from "../../sessions/composer/system-slash-command-guard";
import {
  type AgentChatSendDraftInput,
  createAgentChatSendAttachmentStager,
  resolveAgentChatSendDraftParts,
} from "../../sessions/send/agent-chat-send-draft";
import { installStartupSessionRepair } from "../../sessions/startup/repair-startup-session";
import { findDraftStartupAttempt } from "../../sessions/startup/startup-navigation";
import {
  observeStartupPreparation,
  releaseStartupPreparationAttempt,
} from "../../sessions/startup/startup-prepared-handoff";
import { projectWorkspaceSessionResult } from "./launch-workspace-session";
import type { WorkspaceSessionDraftValidation } from "./workspace-session-draft-validation";
import { workspaceSessionValidationError } from "./workspace-session-worktree-rules";

type SavedWorkspaceOwnershipTarget = Extract<
  Extract<StartupOwnership, { state: "saved" }>["target"],
  { kind: "workspace" }
>;

export type WorkspaceSessionDraftLaunchArgs = {
  connection: ClientConnection;
  sessions: AgentSessionsStore;
  draftId: string;
  submittedComposer: AgentChatComposerDraft;
  request: WorkspaceSessionLaunchRequest;
  onSavedRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
  onBoundRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
  onPreSaveError?: (error: Error) => void;
};

export type WorkspaceSessionDraftLaunchOutcome = {
  startupAttemptId: string;
  result: WorkspaceSessionLaunchResult | null;
  error: Error | null;
};

export type SubmitWorkspaceSessionDraftArgs = {
  connection: ClientConnection;
  sessions: AgentSessionsStore;
  draftId: string;
  submittedComposer: AgentChatComposerDraft;
  reusablePrompts: AgentChatSendDraftInput["reusablePrompts"];
  modelDescriptor: AgentChatSendDraftInput["modelDescriptor"];
  supportsAttachments: boolean;
  buildLaunchRequest: WorkspaceSessionDraftValidation["buildLaunchRequest"];
  onSavedRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
  onBoundRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
  onPreSaveError?: (error: Error) => void;
};

const preserveUnsentDraft = (
  connection: ClientConnection,
  workspaceId: string,
  sessionId: string,
  submittedComposer: AgentChatComposerDraft,
): void => {
  const identity = { workspaceId, workspaceSessionId: sessionId };
  if (!draftHasMeaningfulContent(connection.drafts.chat.hydrate(identity, null))) {
    connection.drafts.chat.set(identity, null, submittedComposer);
  }
};

/**
 * Stages draft attachments, re-checks draft existence and draft-disallowed system commands, builds
 * the launch request, and submits through `launchWorkspaceSessionDraft`. Returns `null` when the
 * draft has no sendable parts, was discarded during staging, or fails request validation.
 */
export async function submitWorkspaceSessionDraft({
  connection,
  sessions,
  draftId,
  submittedComposer,
  reusablePrompts,
  modelDescriptor,
  supportsAttachments,
  buildLaunchRequest,
  onSavedRecord,
  onBoundRecord,
  onPreSaveError,
}: SubmitWorkspaceSessionDraftArgs): Promise<WorkspaceSessionDraftLaunchOutcome | null> {
  const parts = await resolveAgentChatSendDraftParts({
    draft: submittedComposer,
    reusablePrompts,
    modelDescriptor,
    supportsAttachments,
    stageAttachment: createAgentChatSendAttachmentStager(connection.stageAttachment),
  });
  if (!parts || parts.length === 0) return null;
  if (!connection.drafts.newWorkspaceSessions.getDraft(draftId)) return null;
  requireSystemCommandSessionTarget(parts, false);
  const request = buildLaunchRequest({ draftId, parts });
  if (!request) return null;
  const launchArgs: WorkspaceSessionDraftLaunchArgs = {
    connection,
    sessions,
    draftId,
    submittedComposer,
    request,
  };
  if (onSavedRecord) launchArgs.onSavedRecord = onSavedRecord;
  if (onBoundRecord) launchArgs.onBoundRecord = onBoundRecord;
  if (onPreSaveError) launchArgs.onPreSaveError = onPreSaveError;
  return launchWorkspaceSessionDraft(launchArgs);
}

/**
 * Submits a frontend new-session draft through `workspace_session_launch`, retiring the draft
 * on host save confirmation and installing edit/retry or post-save repair actions on failure.
 */
export async function launchWorkspaceSessionDraft(
  args: WorkspaceSessionDraftLaunchArgs,
): Promise<WorkspaceSessionDraftLaunchOutcome> {
  const {
    connection,
    sessions,
    draftId,
    submittedComposer,
    request,
    onSavedRecord,
    onBoundRecord,
    onPreSaveError,
  } = args;
  const { queryClient, startupAttempts } = connection;
  const newDrafts = connection.drafts.newWorkspaceSessions;
  const label = workspaceSessionDraftTitle({ composer: submittedComposer }, submittedComposer);

  const existingDraft = newDrafts.getDraft(draftId);
  if (!existingDraft) {
    return {
      startupAttemptId: "",
      result: null,
      error: new Error("This draft was discarded before the session started."),
    };
  }
  if (newDrafts.isStarting(draftId)) {
    throw new Error("This draft is already starting.");
  }

  const existingAttempt = findDraftStartupAttempt(startupAttempts.getSnapshot(), draftId);
  const startupAttemptId =
    existingAttempt?.id ??
    startupAttempts.begin({
      origin: {
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        scope: { kind: "workspace", draftId },
      },
      label,
      presentation: "inline",
      instructionRequired: true,
      submittedComposer,
    });
  if (existingAttempt) {
    startupAttempts.setSubmittedComposer(startupAttemptId, submittedComposer);
  }

  let notifiedSaved = false;
  let notifiedBound = false;
  const notifyRecord = (saved: WorkspaceSession): void => {
    if (!notifiedSaved) {
      notifiedSaved = true;
      onSavedRecord?.(saved, startupAttemptId);
    }
    if (!notifiedBound && saved.externalSessionId !== null) {
      notifiedBound = true;
      onBoundRecord?.(saved, startupAttemptId);
    }
  };

  const handlePreSaveFailure = (err: Error): void => {
    startupAttempts.setRecoveryActions(startupAttemptId, [
      {
        kind: "edit_choices",
        label: "Edit choices",
        run: () => {
          startupAttempts.release(startupAttemptId);
        },
      },
      {
        kind: "retry",
        label: "Retry",
        run: async () => {
          await launchWorkspaceSessionDraft(args);
        },
      },
    ]);
    onPreSaveError?.(err);
  };

  const stopObservingAttempt = startupAttempts.subscribe(() => {
    const current = startupAttempts.getAttempt(startupAttemptId);
    if (current?.ownership.state === "saved" && current.ownership.target.kind === "workspace") {
      notifyRecord(current.ownership.target.record);
    }
  });

  try {
    releaseStartupPreparationAttempt(queryClient, startupAttemptId);
    const result = await startupAttempts.operation(
      startupAttemptId,
      (startup) => connection.host.client.workspaceSessionLaunch({ ...request, startup }),
      {
        beforeDispatch: () =>
          observeStartupPreparation(queryClient, request.repoPath, startupAttemptId),
      },
    );

    if (result.record) {
      const savedTarget: SavedWorkspaceOwnershipTarget = {
        kind: "workspace",
        record: result.record,
      };
      if (result.session) savedTarget.runtimeSession = result.session;
      startupAttempts.setSaved(startupAttemptId, { state: "saved", target: savedTarget });
      projectWorkspaceSessionResult(result, sessions, queryClient);
      void invalidateTerminalList(queryClient, {
        kind: "workspace_session",
        workspaceId: request.workspaceId,
        sessionId: result.record.id,
      }).catch((cause) => console.error("Cannot refresh workspace session terminals.", cause));
      if (request.location === "local_worktree") {
        void invalidateRepoBranchesQuery(queryClient, request.repoPath).catch((cause) =>
          console.error("Cannot refresh workspace session branches.", cause),
        );
      }
      notifyRecord(result.record);
    }

    if (result.status === "completed") {
      await startupAttempts.complete(startupAttemptId);
      return { startupAttemptId, result, error: null };
    }

    const failureMessage =
      result.failure?.message ??
      (result.status === "canceled"
        ? "Workspace session creation was canceled."
        : "Workspace session creation failed.");
    const latest = startupAttempts.getAttempt(startupAttemptId);
    if (latest && !["failed", "canceled"].includes(latest.status.phase)) {
      startupAttempts.fail(startupAttemptId, failureMessage, true);
    }

    if (!result.record) {
      const err = new Error(failureMessage);
      handlePreSaveFailure(err);
      return { startupAttemptId, result, error: err };
    }

    if (result.unsentInstruction && result.unsentInstruction.length > 0) {
      preserveUnsentDraft(connection, request.workspaceId, result.record.id, submittedComposer);
    }

    if (result.record.externalSessionId === null) {
      installStartupSessionRepair(queryClient, sessions, startupAttemptId);
    } else {
      startupAttempts.setRecoveryActions(startupAttemptId, []);
    }

    return { startupAttemptId, result, error: new Error(failureMessage) };
  } catch (cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    if (workspaceSessionValidationError(err)) {
      void invalidateRepoBranchesQuery(queryClient, request.repoPath);
    }
    if (request.location === "existing_worktree") {
      void queryClient.invalidateQueries({
        queryKey: workspaceSessionWorktreesQueryOptions(request.workspaceId).queryKey,
      });
    }
    const latest = startupAttempts.getAttempt(startupAttemptId);
    if (latest && !["ready", "failed", "canceled"].includes(latest.status.phase)) {
      startupAttempts.fail(startupAttemptId, err.message, true);
    }
    const settled = startupAttempts.getAttempt(startupAttemptId);
    if (settled?.ownership.state === "saved" && settled.ownership.target.kind === "workspace") {
      const saved = settled.ownership.target.record;
      const confirmedNotSent =
        settled.instruction?.state === "not_sent" ||
        (settled.instruction === undefined &&
          settled.status.confirmation === "current" &&
          (settled.status.phase === "failed" || settled.status.phase === "canceled"));
      if (request.parts.length > 0 && confirmedNotSent) {
        preserveUnsentDraft(connection, request.workspaceId, saved.id, submittedComposer);
      }
      if (saved.externalSessionId === null) {
        installStartupSessionRepair(queryClient, sessions, startupAttemptId);
      } else {
        startupAttempts.setRecoveryActions(startupAttemptId, []);
      }
    } else {
      handlePreSaveFailure(err);
    }
    return { startupAttemptId, result: null, error: err };
  } finally {
    stopObservingAttempt();
  }
}
