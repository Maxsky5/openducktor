import type {
  AcceptedAgentUserMessage,
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
  WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { chatNamingWorkText } from "@openducktor/workflows";
import { Effect } from "effect";
import { toBranchSlug } from "../../domain/naming/naming-output";
import { checkoutBranch, cleanTaskBranchPrefix } from "../../domain/task/task-branch-policy";
import {
  planRuntimeTitleRename,
  runtimeTitle,
  visibleMessageText,
} from "../../domain/workspace-sessions/workspace-session-title";
import type { HostError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
} from "../../ports/workspace-session-store-port";
import type {
  AgentSessionSendContent,
  ScopedAgentSessionRef,
} from "../agent-sessions/agent-session-operation-policy";
import { startupStep } from "../agent-sessions/session-startup-progress";
import { branchNamingStep, nameBranch } from "../naming/branch-naming";
import { namingFailureNotice, type NamingService } from "../naming/naming-service";
import {
  renameTemporaryBranch,
  requireConfirmedAutomaticBranch,
  type FinalizedBranch,
} from "./workspace-session-branch-rename";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionUpdatedPublisher,
} from "./workspace-session-persistence-callbacks";
import { titleSyncNeedsTurn, type TitleSyncState } from "./workspace-session-runtime-title-sync";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

/** The startup step that renames the temporary branch when the workspace has no naming model. */
const FINALIZE_BRANCH_STEP = { id: "naming", label: "Finalize branch name" } as const;

/**
 * What this host process knows about a chat that it created, until its first accepted message.
 * `created` holds the temporary branch that this host created because the user left both names
 * blank. That branch tracks the target branch until the first message sets the upstream of its
 * final name. `renamed` follows a Git rename whose record save did not finish, so the next send
 * saves the final branch without a second rename. `branchNamed` follows the saved final branch.
 * Both hold the title that the branch request gave, or null. Only a fact authorizes a branch
 * rename, because a branch name gives no proof that OpenDucktor created the branch.
 */
type CreationFact =
  | { stage: "created"; temporaryBranch: string | null }
  | ({ stage: "renamed" } & FinalizedBranch)
  | { stage: "branchNamed"; title: string | null };

type FactRef = Pick<WorkspaceSessionStoreRef, "workspaceId" | "sessionId">;
type LocatedSession = { ref: WorkspaceSessionStoreRef; session: WorkspaceSession };

export type WorkspaceSessionNamingDependencies = {
  service: NamingService;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  git: Pick<
    GitPort,
    "listRefNames" | "listRemoteNames" | "renameCheckedOutBranch" | "configureBranchUpstream"
  >;
};

/**
 * The naming of the chats that this host creates: the final branch of an unnamed chat worktree
 * before its first message reaches the agent, and the model title after that message. It owns the
 * creation facts of the chats, from creation to the first accepted message.
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
  store: Pick<WorkspaceSessionStorePort, "setGeneratedTitle" | "setExecutionTarget">;
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
  const facts = new Map<string, CreationFact>();
  const factKey = ({ workspaceId, sessionId }: FactRef) => JSON.stringify([workspaceId, sessionId]);
  /** Moves a fact to its next stage. A fact that the first message retired stays retired. */
  const advance = (ref: FactRef, fact: CreationFact) => {
    if (facts.has(factKey(ref))) facts.set(factKey(ref), fact);
  };

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
        // A sync that waits for the end of the turn reads the saved title then.
        const sync = titleSync.get(agentSessionRefKey(runtimeRef));
        if (titleSyncNeedsTurn(runtimeRef.runtimeKind) && (sync === "pending" || sync === "queued"))
          return;
        const rename = planRuntimeTitleRename(current.session, runtimeTitle(saved));
        if (rename !== null)
          yield* renameRuntimeTitle({
            ...rename,
            repoPath: current.ref.repoPath,
            runtimeKind: current.session.runtimeKind,
            workingDirectory: current.session.executionTarget.workingDirectory,
          });
      }),
    );

  /**
   * Names a chat from its first accepted message. A title from the request that named the branch
   * needs no second request. A time-out keeps the shortened title.
   */
  const nameFromFirstMessage = (
    runtimeRef: AgentSessionLiveRef,
    ref: WorkspaceSessionStoreRef,
    fact: CreationFact,
    message: AcceptedAgentUserMessage,
  ) =>
    Effect.gen(function* () {
      if (fact.stage !== "created") {
        if (fact.title !== null) yield* applyGeneratedTitle(runtimeRef, ref, fact.title);
        return;
      }
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

  /** Saves the final branch of a renamed chat worktree, publishes it, and reports its notice. */
  const saveFinalBranch = (
    input: AgentSessionSendContent,
    known: LocatedSession,
    target: Extract<WorkspaceSession["executionTarget"], { kind: "local_worktree" }>,
    finalized: FinalizedBranch,
  ) =>
    Effect.gen(function* () {
      const saved = yield* storeEffect(
        store.setExecutionTarget({
          ...known.ref,
          executionTarget: { ...target, branchName: finalized.branch },
        }),
      );
      advance(known.ref, { stage: "branchNamed", title: finalized.title });
      yield* publishUpdated(known.ref.workspaceId, saved);
      if (finalized.notice !== null)
        yield* reportRenameFailure(input, finalized.notice, "workspaceSession.naming");
    });

  return {
    /** Records a chat that this host created, with the temporary branch it created, or null. */
    registerCreated: (ref: FactRef, temporaryBranch: string | null) => {
      facts.set(factKey(ref), { stage: "created", temporaryBranch });
    },

    /**
     * Gives an unnamed chat worktree its final branch before the agent gets the first message,
     * and saves it. A chat that this host did not create gets no rename.
     */
    prepareDelivery: (input: AgentSessionSendContent) =>
      Effect.gen(function* () {
        if (input.sessionScope.kind !== "repository") return;
        const known = yield* find(input);
        if (!known) return;
        const fact = facts.get(factKey(known.ref));
        const target = known.session.executionTarget;
        if (!fact) return yield* requireConfirmedAutomaticBranch(known.session);
        // Git has the final branch already. Only the save of the record failed.
        if (fact.stage === "renamed" && target.kind === "local_worktree")
          return yield* Effect.uninterruptible(saveFinalBranch(input, known, target, fact));
        if (
          fact.stage !== "created" ||
          fact.temporaryBranch === null ||
          target.kind !== "local_worktree" ||
          target.branchName !== fact.temporaryBranch
        )
          return;
        const temporaryBranch = fact.temporaryBranch;
        const messageText = visibleMessageText(input.parts);
        const repoConfig = yield* naming.settings.getRepoConfig(known.ref.workspaceId);
        // A manual title wins, so the request asks for the branch only.
        const withTitle = known.session.manualTitle === null;
        const chatTarget = known.session.targetBranch ?? repoConfig.defaultTargetBranch;
        yield* startupStep(
          branchNamingStep(repoConfig, withTitle) ?? FINALIZE_BRANCH_STEP,
          Effect.gen(function* () {
            const named = yield* nameBranch(
              { naming: naming.service, git: naming.git },
              {
                repoConfig,
                gitDirectory: target.workingDirectory,
                workText: chatNamingWorkText(messageText),
                reserved: [checkoutBranch(chatTarget)],
                fallback: `${cleanTaskBranchPrefix(repoConfig.branchPrefix)}/${toBranchSlug(messageText) || "session"}`,
                withTitle,
              },
            );
            // A stop after the rename still saves the branch, so the record matches Git.
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const finalized = yield* renameTemporaryBranch(naming.git, {
                  named,
                  workingDirectory: target.workingDirectory,
                  temporaryBranch,
                  upstreamRemote: chatTarget.remote?.trim() || null,
                });
                advance(known.ref, { stage: "renamed", ...finalized });
                yield* saveFinalBranch(input, known, target, finalized);
              }),
            );
          }),
        );
      }),

    /**
     * Retires the creation fact of a chat at its first accepted message. Returns the job that
     * names the chat from that message, or null when this host did not create the chat or the
     * chat has a manual title, which wins.
     */
    takeFirstMessageNaming: (
      runtimeRef: AgentSessionLiveRef,
      located: LocatedSession,
      message: AcceptedAgentUserMessage,
    ): Effect.Effect<void> | null => {
      const fact = facts.get(factKey(located.ref));
      facts.delete(factKey(located.ref));
      if (!fact || located.session.manualTitle !== null) return null;
      return nameFromFirstMessage(runtimeRef, located.ref, fact, message);
    },
  };
};

export type WorkspaceSessionNaming = ReturnType<typeof createWorkspaceSessionNaming>;
