import { useRuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  useClientConnection,
  useHostClient,
} from "@openducktor/frontend-core/connection/client-connection-react";
import {
  buildWorkspaceConflictPrompt,
  CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON,
  chatConflictBlockedReason,
  conflictBuilderSessions,
  describeConflictRequestReceipt,
  type GitConflictAssistanceResult,
} from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
import {
  abortGitConflict,
  isAbortableGitConflict,
} from "@openducktor/frontend-core/git/conflicts/abort-git-conflict";
import {
  CONFLICT_ABORT_REFRESH_FAILED_TITLE,
  CONFLICT_ABORT_UNAVAILABLE_MESSAGE,
  UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import {
  type StartGitConflictResolutionSessionInput,
  toConflictResolutionStartRequest,
  useGitConflictResolution,
} from "@openducktor/frontend-core/git/conflicts/use-git-conflict-resolution";
import type { GitConflict, GitConflictAction } from "@openducktor/frontend-core/git/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { normalizeWorkingDirectory } from "@openducktor/frontend-core/lib/working-directory";
import {
  repoConfigQueryOptions,
  toRepoSettingsInput,
} from "@openducktor/frontend-core/queries/workspace";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useAgentMessageSendPolicy } from "@openducktor/frontend-core/sessions/send/use-agent-message-send-policy";
import {
  useAgentOperationsContext,
  useAgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { resolveRequiredDefaultSessionSelection } from "@openducktor/frontend-core/sessions/session-start-selection";
import type { ResolvedSessionStartDecision } from "@openducktor/frontend-core/sessions/start/session-start-types";
import { useSessionStartWorkflowRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-workflow-runner";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { unknownOutcomeGuidance } from "./conflict-model";

/** A notice next to the conflict actions, such as a failure or an unknown result. */
type ConflictNotice = {
  tone: "warning" | "destructive";
  title: string;
  message: string;
};

export type GitConflictActions = {
  action: GitConflictAction;
  notice: ConflictNotice | null;
  /** Why the agent cannot receive a conflict request now, or null when it can. */
  askBlockedReason: string | null;
  /** What Ask the agent does: reuse a Builder, start one, or send to the chat. */
  askDescription: string;
  abort: () => Promise<void>;
  askAgent: () => Promise<void>;
};

/** The Builder sessions of a task from the live session state of its workspace. */
const useTaskBuilderSessions = (
  repoPath: string,
  taskId: string | null,
): AgentSessionSummary[] | null => {
  const sessions = useAgentSessionsContext();
  const getSnapshot = useCallback(
    () => sessions.getWorkspaceStore(repoPath)?.getActivitySnapshot() ?? null,
    [repoPath, sessions],
  );
  const snapshot = useSyncExternalStore(sessions.subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () =>
      taskId === null || snapshot === null
        ? null
        : snapshot.sessions.filter(
            (session) => session.taskId === taskId && session.role === "build",
          ),
    [snapshot, taskId],
  );
};

/**
 * Abort and Ask the agent to resolve for the Git Conflict of a work owner. Abort uses the host
 * command. A task follows the desktop flow: it sends the conflict request to the Builder in the
 * conflict directory, or starts a Builder there with the repository default model. A chat sends
 * the request to its own agent. One action runs at a time. A lost result shows as Result unknown
 * and never runs again by itself.
 */
export function useGitConflictActions({
  owner,
  conflict,
  onOpenSession,
}: {
  owner: WorkOwner;
  conflict: GitConflict | null;
  onOpenSession: (session: AgentSessionIdentity) => void;
}): GitConflictActions {
  const host = useHostClient();
  const { feedback } = useClientConnection();
  const queryClient = useQueryClient();
  const { sendAgentMessage } = useAgentOperationsContext();
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const assertCanSubmit = useAgentMessageSendPolicy();
  const [action, setAction] = useState<GitConflictAction>(null);
  const [notice, setNotice] = useState<ConflictNotice | null>(null);
  const running = useRef(false);
  const { workspaceId } = owner.workspace;
  const { repoPath, task, record } = owner;
  const builderSessions = useTaskBuilderSessions(repoPath, task?.id ?? null);
  const runWorkflow = useSessionStartWorkflowRunner({ workspaceId, repoPath });

  const startConflictResolutionSession = useCallback(
    async (request: StartGitConflictResolutionSessionInput) => {
      let decision: ResolvedSessionStartDecision;
      if (request.initialStartMode === "reuse" && request.initialSourceSession) {
        decision = { startMode: "reuse", sourceSession: request.initialSourceSession };
      } else {
        const config = await queryClient.fetchQuery(repoConfigQueryOptions(workspaceId));
        decision = {
          startMode: "fresh",
          selectedModel: await resolveRequiredDefaultSessionSelection({
            role: "build",
            repoSettings: toRepoSettingsInput(config),
            repoPath,
            loadRepoRuntimeCatalog,
          }),
        };
      }
      return runWorkflow({ request: toConflictResolutionStartRequest(request), decision, task });
    },
    [loadRepoRuntimeCatalog, queryClient, repoPath, runWorkflow, task, workspaceId],
  );
  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId,
    startConflictResolutionSession,
  });

  const defaultBuilder =
    conflict && builderSessions
      ? conflictBuilderSessions(conflict, builderSessions, null).defaultBuilder
      : null;
  let askBlockedReason: string | null = null;
  if (!conflict?.operation || !conflict.workingDir) {
    askBlockedReason = UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON;
  } else if (record) {
    askBlockedReason = chatConflictBlockedReason(record, conflict);
  } else if (builderSessions === null) {
    askBlockedReason = "The sessions of this workspace are still loading. Try again in a moment.";
  }
  let askDescription = `Sends the conflict to the ${owner.recipientLabel} of this chat.`;
  if (task) {
    askDescription = defaultBuilder
      ? "Sends the conflict to the latest Builder in the conflict worktree."
      : "Starts a Builder with the repository default model in the conflict worktree, then sends the conflict.";
  }

  const run = useCallback(
    async (kind: Exclude<GitConflictAction, null>, work: () => Promise<void>): Promise<void> => {
      if (running.current) return;
      running.current = true;
      setAction(kind);
      setNotice(null);
      try {
        await work();
      } finally {
        running.current = false;
        setAction(null);
      }
    },
    [],
  );

  const abort = useCallback(
    () =>
      run("abort", async () => {
        if (!conflict || !isAbortableGitConflict(conflict)) {
          setNotice({
            tone: "destructive",
            title: "Cannot abort",
            message: CONFLICT_ABORT_UNAVAILABLE_MESSAGE,
          });
          return;
        }
        const result = await abortGitConflict(host, repoPath, conflict);
        if (result.kind === "failed") {
          const guidance = unknownOutcomeGuidance(result.error);
          if (guidance !== null) {
            setNotice({ tone: "warning", title: "Result unknown", message: guidance });
            return;
          }
          const message = errorMessage(result.error);
          setNotice({ tone: "destructive", title: result.title, message });
          feedback.show("error", result.title, { description: message });
          return;
        }
        feedback.show("success", result.title);
        try {
          await owner.git.refresh("soft");
        } catch (cause) {
          const message = errorMessage(cause);
          setNotice({ tone: "warning", title: CONFLICT_ABORT_REFRESH_FAILED_TITLE, message });
          feedback.show("error", CONFLICT_ABORT_REFRESH_FAILED_TITLE, { description: message });
        }
      }),
    [conflict, feedback, host, owner.git, repoPath, run],
  );

  const showReceipt = useCallback(
    (receipt: GitConflictAssistanceResult): void => {
      if (!receipt) return;
      const outcome = describeConflictRequestReceipt(receipt, owner.recipientLabel);
      if (outcome.kind === "sent") feedback.show("success", outcome.title);
      if (outcome.kind === "host_step_failed") {
        setNotice({ tone: "warning", title: outcome.title, message: outcome.message });
      }
      if (outcome.kind === "uncertain") {
        setNotice({ tone: "warning", title: "Result unknown", message: outcome.message });
      }
    },
    [feedback, owner.recipientLabel],
  );

  const askChat = useCallback(
    async (target: GitConflict): Promise<void> => {
      if (!record) return;
      const identity = workspaceSessionIdentity(record);
      if (!identity) throw new Error("Send a first message in this chat, then ask again.");
      const workingDirectory = normalizeWorkingDirectory(target.workingDir);
      const receipt = await sendAgentMessage(
        identity,
        [{ kind: "text", text: buildWorkspaceConflictPrompt(target) }],
        {
          assertCanSubmit: (session) => {
            if (normalizeWorkingDirectory(session.workingDirectory) !== workingDirectory) {
              throw new Error(CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON);
            }
            assertCanSubmit(session);
          },
        },
      );
      if (!receipt) throw new Error("The chat session is not loaded. Open the chat and try again.");
      showReceipt(receipt);
      onOpenSession(identity);
    },
    [assertCanSubmit, onOpenSession, record, sendAgentMessage, showReceipt],
  );

  const askAgent = useCallback(
    () =>
      run("ask_builder", async () => {
        if (!conflict || askBlockedReason) {
          setNotice({
            tone: "destructive",
            title: `Cannot contact the ${owner.recipientLabel}`,
            message: askBlockedReason ?? "No Git conflict is open.",
          });
          return;
        }
        try {
          if (record) {
            await askChat(conflict);
            return;
          }
          if (!task || !builderSessions) return;
          const receipt = await handleResolveGitConflict(
            conflict,
            {
              taskId: task.id,
              task,
              builderSessions,
              currentViewSession: null,
              onOpenSession,
            },
            assertCanSubmit,
          );
          showReceipt(receipt);
        } catch (cause) {
          const guidance = unknownOutcomeGuidance(cause);
          if (guidance !== null) {
            setNotice({ tone: "warning", title: "Result unknown", message: guidance });
            return;
          }
          const message = errorMessage(cause);
          setNotice({
            tone: "destructive",
            title: `Failed to contact ${owner.recipientLabel}`,
            message,
          });
          feedback.show("error", `Failed to contact ${owner.recipientLabel}`, {
            description: message,
          });
        }
      }),
    [
      askBlockedReason,
      askChat,
      assertCanSubmit,
      builderSessions,
      conflict,
      feedback,
      handleResolveGitConflict,
      onOpenSession,
      owner.recipientLabel,
      record,
      run,
      showReceipt,
      task,
    ],
  );

  return { action, notice, askBlockedReason, askDescription, abort, askAgent };
}
