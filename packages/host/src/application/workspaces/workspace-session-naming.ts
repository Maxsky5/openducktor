import {
  hasAutomaticWorktreeBranch,
  type AcceptedAgentUserMessage,
  type AgentSessionControlUpdateTitleInput,
  type AgentSessionLiveRef,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { chatNamingWorkText } from "@openducktor/workflows";
import { Effect } from "effect";
import { toBranchSlug } from "../../domain/naming/naming-output";
import { cleanTaskBranchPrefix } from "../../domain/task/task-branch-policy";
import {
  runtimeTitle,
  visibleMessageText,
} from "../../domain/workspace-sessions/workspace-session-title";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
} from "../../ports/workspace-session-store-port";
import type {
  AgentSessionSendContent,
  ScopedAgentSessionRef,
} from "../agent-sessions/agent-session-operation-policy";
import { namingFailureNotice, type NamingService } from "../naming/naming-service";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionUpdatedPublisher,
} from "./workspace-session-persistence-callbacks";
import {
  planNativeRename,
  type TitleSyncState,
  syncsTitleAfterTurn,
} from "./workspace-session-runtime-title-sync";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const fallbackWorkspaceSessionBranch = (branchPrefix: string, messageText: string): string =>
  `${cleanTaskBranchPrefix(branchPrefix)}/${toBranchSlug(messageText) || "session"}`;

/**
 * Stops the first message of a legacy pre-upgrade unnamed worktree chat whose temporary branch
 * was never renamed before host restart.
 */
export const requireConfirmedAutomaticBranch = (
  session: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
) => {
  const target = session.executionTarget;
  if (!hasAutomaticWorktreeBranch(session) || target.kind !== "local_worktree") return Effect.void;
  const branch = target.branchName;
  return Effect.fail(
    new HostValidationError({
      field: "branchName",
      message: `OpenDucktor cannot confirm that it created branch ${branch} for this chat, because the host restarted before the first message. Your message is kept. Rename the branch in Git, for example git branch -m ${branch} <name>, then start a new chat on Existing worktree with ${target.workingDirectory}.`,
    }),
  );
};

type FactRef = Pick<WorkspaceSessionStoreRef, "workspaceId" | "sessionId">;
type LocatedSession = { ref: WorkspaceSessionStoreRef; session: WorkspaceSession };

export type WorkspaceSessionNamingDependencies = {
  service: NamingService;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
};

/**
 * Owns model-generated title naming for chats created by this host whose branch was not named
 * with a title up front.
 */
export const createWorkspaceSessionNaming = ({
  naming,
  store,
  find,
  publishUpdated,
  reportRenameFailure,
  sessionTitleGate,
  titleSync,
  renameRuntimeTitle,
  storeEffect,
}: {
  naming: WorkspaceSessionNamingDependencies;
  store: Pick<WorkspaceSessionStorePort, "setGeneratedTitle">;
  find: (ref: ScopedAgentSessionRef) => Effect.Effect<LocatedSession | null, HostError>;
  publishUpdated: WorkspaceSessionUpdatedPublisher;
  reportRenameFailure: WorkspaceSessionRenameFailureReporter;
  sessionTitleGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
  titleSync: TitleSyncState;
  renameRuntimeTitle: (
    input: AgentSessionControlUpdateTitleInput,
  ) => Effect.Effect<void, HostError>;
  storeEffect: <A>(effect: Effect.Effect<A, TaskStoreError>) => Effect.Effect<A, HostError>;
}) => {
  const createdKeys = new Set<string>();
  const factKey = ({ workspaceId, sessionId }: FactRef) => JSON.stringify([workspaceId, sessionId]);

  /** Saves a model title and syncs the effective title, under the title gate. */
  const applyGeneratedTitle = (
    runtimeRef: AgentSessionLiveRef,
    ref: WorkspaceSessionStoreRef,
    title: string,
  ) =>
    sessionTitleGate.run(
      ref,
      Effect.gen(function* () {
        const current = yield* find(runtimeRef);
        if (!current) return;
        const saved = yield* storeEffect(
          store.setGeneratedTitle({ ...current.ref, generatedTitle: title }),
        );
        yield* publishUpdated(current.ref.workspaceId, saved);
        const sync = titleSync.get(agentSessionRefKey(runtimeRef));
        if (
          syncsTitleAfterTurn(runtimeRef.runtimeKind) &&
          (sync === "pending" || sync === "queued")
        )
          return;
        const rename = planNativeRename(current.session, runtimeTitle(saved));
        if (rename !== null)
          yield* renameRuntimeTitle({
            ...rename,
            repoPath: current.ref.repoPath,
            runtimeKind: current.session.runtimeKind,
            workingDirectory: current.session.executionTarget.workingDirectory,
          });
      }),
    );

  const nameFromFirstMessage = (
    runtimeRef: AgentSessionLiveRef,
    ref: WorkspaceSessionStoreRef,
    message: AcceptedAgentUserMessage,
  ) =>
    Effect.gen(function* () {
      const text = visibleMessageText(message.parts);
      if (!text) return;
      const repoConfig = yield* naming.settings.getRepoConfig(ref.workspaceId);
      const outcome = yield* naming.service.generate({
        repoConfig,
        kind: "title",
        workText: chatNamingWorkText(text),
      });
      if (outcome.status === "failed")
        return yield* reportRenameFailure(
          runtimeRef,
          namingFailureNotice(outcome.message, "the shortened message as the title"),
          "workspaceSession.naming",
        );
      if (outcome.status === "generated")
        yield* applyGeneratedTitle(runtimeRef, ref, outcome.answer.title);
    }).pipe(
      Effect.catch((failure) =>
        reportRenameFailure(
          runtimeRef,
          `Could not save the generated title of this Workspace Session. The shortened message stays as the title. ${failure.message}`,
          "workspaceSession.naming",
        ),
      ),
    );

  return {
    /** Records a chat that this host created without an upfront model title. */
    registerCreated: (ref: FactRef) => {
      createdKeys.add(factKey(ref));
    },

    /** Guards legacy pre-upgrade automatic temporary branches before first delivery. */
    prepareDelivery: (input: AgentSessionSendContent) =>
      Effect.gen(function* () {
        if (input.sessionScope.kind !== "repository") return;
        const known = yield* find(input);
        if (!known || createdKeys.has(factKey(known.ref))) return;
        yield* requireConfirmedAutomaticBranch(known.session);
      }),

    /** Retires the creation record at the first accepted message and starts title naming. */
    takeFirstMessageNaming: (
      runtimeRef: AgentSessionLiveRef,
      located: LocatedSession,
      message: AcceptedAgentUserMessage,
    ): Effect.Effect<void> | null => {
      const key = factKey(located.ref);
      const wasCreated = createdKeys.delete(key);
      if (!wasCreated || located.session.manualTitle !== null) return null;
      return nameFromFirstMessage(runtimeRef, located.ref, message);
    },
  };
};

export type WorkspaceSessionNaming = ReturnType<typeof createWorkspaceSessionNaming>;
