import type {
  AcceptedAgentUserMessage,
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
  WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { chatNamingWorkText } from "@openducktor/workflows";
import { Effect, Fiber } from "effect";
import {
  planRuntimeTitleRename,
  runtimeTitle,
  visibleMessageText,
} from "../../domain/workspace-sessions/workspace-session-title";
import type { HostError } from "../../effect/host-errors";
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
import { checkoutBranch } from "../../domain/task/task-branch-policy";
import { readTakenBranchNames } from "../naming/free-branch-name";
import { namingFailureNotice } from "../naming/naming-service";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionUpdatedPublisher,
} from "./workspace-session-persistence-callbacks";
import {
  renameTemporaryBranch,
  requireConfirmedAutomaticBranch,
  type CreationFacts,
  type FinalizedBranch,
  type WorkspaceSessionNamingDependencies,
} from "./workspace-session-naming";
import { titleSyncNeedsTurn, type TitleSyncState } from "./workspace-session-runtime-title-sync";

type LocatedSession = { ref: WorkspaceSessionStoreRef; session: WorkspaceSession };

/** The startup step of the first-message naming of an unnamed chat worktree. */
const namingStepLabel = (hasNamingModel: boolean, needsTitle: boolean): string => {
  if (!hasNamingModel) return "Finalize branch name";
  if (needsTitle) return "Generate branch name and session title";
  return "Generate branch name";
};

/**
 * The naming steps of a chat that the session persistence runs: the final branch of an unnamed
 * worktree before the first message, and the model title after it.
 */
export const createWorkspaceSessionNamingPolicy = ({
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
   * Names a chat from its first accepted message, in the background. A title from the request
   * that named the branch needs no second request. A time-out keeps the shortened title.
   */
  const nameFromFirstMessage = (
    runtimeRef: AgentSessionLiveRef,
    ref: WorkspaceSessionStoreRef,
    fact: CreationFacts,
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
        outputs: { title: true, branch: false },
        workText: chatNamingWorkText(text),
      });
      if (outcome.kind === "failed")
        return yield* reportRenameFailure(
          runtimeRef,
          namingFailureNotice(outcome.message, "the shortened message as the title"),
          "workspaceSession.naming",
        );
      if (outcome.kind === "generated" && outcome.title)
        yield* applyGeneratedTitle(runtimeRef, ref, outcome.title);
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
      naming.facts.branchFinalized(known.ref, finalized.title);
      yield* publishUpdated(known.ref.workspaceId, saved);
      if (finalized.notice !== null)
        yield* reportRenameFailure(input, finalized.notice, "workspaceSession.naming");
    });

  /**
   * Gives an unnamed chat worktree its final branch before the agent gets the first message, and
   * saves it. A chat that this host did not create gets no rename.
   */
  const prepareDelivery = (input: AgentSessionSendContent) =>
    Effect.gen(function* () {
      if (input.sessionScope.kind !== "repository") return;
      const known = yield* find(input);
      if (!known) return;
      const fact = naming.facts.get(known.ref);
      const target = known.session.executionTarget;
      if (!fact) {
        return yield* requireConfirmedAutomaticBranch(known.session);
      }
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
      const needsTitle = known.session.manualTitle === null;
      const label = namingStepLabel(repoConfig.namingModel !== undefined, needsTitle);
      const chatTarget = known.session.targetBranch ?? repoConfig.defaultTargetBranch;
      yield* startupStep(
        { id: "naming", label },
        Effect.gen(function* () {
          // The listing runs while the model writes the name.
          const taken = yield* Effect.forkChild(
            readTakenBranchNames(naming.git, target.workingDirectory, [checkoutBranch(chatTarget)]),
          );
          const outcome = yield* naming.service.generate({
            repoConfig,
            outputs: { title: needsTitle, branch: true },
            workText: chatNamingWorkText(messageText),
          });
          // A stop after the rename still saves the branch, so the record matches Git.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const finalized = yield* renameTemporaryBranch(naming.git, {
                repoConfig,
                outcome,
                workingDirectory: target.workingDirectory,
                temporaryBranch,
                upstreamRemote: chatTarget.remote?.trim() || null,
                messageText,
                taken: yield* Fiber.join(taken),
              });
              naming.facts.branchRenamed(known.ref, finalized);
              yield* saveFinalBranch(input, known, target, finalized);
            }),
          );
        }),
      );
    });

  return { prepareDelivery, nameFromFirstMessage };
};
