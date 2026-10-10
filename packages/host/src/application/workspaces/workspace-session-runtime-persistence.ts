import type {
  AcceptedAgentUserMessage,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
  WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey, type AgentSessionSummary } from "@openducktor/core";
import { Effect, Exit, FiberSet, Scope } from "effect";
import {
  buildWorkspaceSessionTitle,
  planRuntimeTitleRename,
  runtimeTitle,
} from "../../domain/workspace-sessions/workspace-session-title";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  isHostError,
} from "../../effect/host-errors";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
} from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import type { AgentSessionOperationPolicy } from "../agent-sessions/agent-session-operation-policy";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import {
  titleSyncNeedsTurn,
  syncTitleAfterTurn,
  type TitleSyncState,
} from "./workspace-session-runtime-title-sync";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";
import type {
  WorkspaceSessionRenameFailureReporter,
  WorkspaceSessionRuntimeTitleUpdater,
  WorkspaceSessionUpdatedPublisher,
} from "./workspace-session-persistence-callbacks";

type AcceptedMessagePlan = {
  input: Parameters<WorkspaceSessionStorePort["recordAcceptedMessage"]>[0];
  runtimeRename: AgentSessionControlUpdateTitleInput | null;
};

export const createWorkspaceSessionRuntimePersistence = ({
  store,
  settings,
  git,
  publishUpdated,
  operationGate,
  sessionTitleGate,
  updateRuntimeSessionTitle,
  reportRenameFailure,
}: {
  store: WorkspaceSessionStorePort;
  settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
  git: WorkspaceSessionTargetDependencies["git"];
  publishUpdated: WorkspaceSessionUpdatedPublisher;
  operationGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
  sessionTitleGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
  updateRuntimeSessionTitle: WorkspaceSessionRuntimeTitleUpdater;
  reportRenameFailure: WorkspaceSessionRenameFailureReporter;
}): AgentSessionPersistencePort &
  AgentSessionOperationPolicy & {
    recordActivity(ref: AgentSessionLiveRef, occurredAt: number): Effect.Effect<boolean, HostError>;
    isTitleSyncPending: (ref: AgentSessionLiveRef) => boolean;
    markTitleSyncPending: (ref: AgentSessionLiveRef) => void;
    /** Stops background renames and title syncs before their runtime and store close. */
    shutdown: () => Effect.Effect<void>;
  } => {
  // Owns background renames and title syncs. Closing the scope interrupts them and waits.
  const jobsScope = Scope.makeUnsafe();
  const jobs = Effect.runSync(Scope.provide(FiberSet.make<void>(), jobsScope));
  const startJob = (job: Effect.Effect<void>) => FiberSet.run(jobs, job).pipe(Effect.asVoid);
  const sendsInFlight = new Set<string>();
  const titleSync: TitleSyncState = new Map();
  /** Saves locally and leaves the native title write until a completed turn. */
  const saveMessage = (
    runtimeRef: AgentSessionLiveRef,
    known: { ref: WorkspaceSessionStoreRef; session: WorkspaceSession },
    input: AcceptedMessagePlan["input"],
  ) =>
    Effect.gen(function* () {
      const saved = yield* storeEffect(store.recordAcceptedMessage(input));
      if (known.session.generatedTitle === null) {
        const key = agentSessionRefKey(runtimeRef);
        const state = titleSync.get(key);
        const titleAdded = runtimeTitle(known.session) === null && input.generatedTitle !== null;
        if (state === undefined || (state !== "pending" && titleAdded))
          titleSync.set(key, "pending");
      }
      yield* publishUpdated(known.ref.workspaceId, saved);
    });
  const find = (runtimeRef: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfigByRepoPath(runtimeRef.repoPath);
      const scope = { workspaceId: config.workspaceId, repoPath: runtimeRef.repoPath };
      const session = yield* storeEffect(
        store.findByRuntimeSession({
          ...scope,
          runtimeKind: runtimeRef.runtimeKind,
          externalSessionId: runtimeRef.externalSessionId,
        }),
      );
      if (!session) return null;
      if (session.executionTarget.workingDirectory !== runtimeRef.workingDirectory) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Runtime directory does not match Workspace Session ${session.id}: ${runtimeRef.workingDirectory}`,
            field: "workingDirectory",
          }),
        );
      }
      return { ref: { ...scope, sessionId: session.id }, session };
    });
  const requireActive = (session: WorkspaceSession) =>
    session.archivedAt === null
      ? Effect.void
      : Effect.fail(
          new HostValidationError({
            message: "Restore this Workspace Session before opening or changing it.",
            field: "sessionId",
          }),
        );
  const findActive = (runtimeRef: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const known = yield* find(runtimeRef);
      if (!known) return null;
      yield* requireActive(known.session);
      yield* validateWorkspaceSessionTarget(
        { git },
        runtimeRef.repoPath,
        known.session.executionTarget,
      );
      return known;
    });
  const prepare = <Input extends AgentSessionControlResumeInput | AgentSessionControlSendInput>(
    input: Input,
  ): Effect.Effect<Input, HostError> =>
    Effect.gen(function* () {
      if (input.sessionScope.kind !== "repository") return input;
      const known = yield* findActive(input);
      if (!known) return input;
      const storedTitle = runtimeTitle(known.session);
      const prepared = {
        ...input,
        sessionScope:
          storedTitle === null
            ? input.sessionScope
            : { kind: "repository" as const, title: storedTitle },
        systemPrompt: known.session.roleSnapshot?.systemPrompt ?? "",
      };
      if (known.session.selectedModel !== null) prepared.model = known.session.selectedModel;
      return prepared;
    });
  const planAcceptedMessage = (
    known: { ref: WorkspaceSessionStoreRef; session: WorkspaceSession },
    runtimeRef: AgentSessionLiveRef,
    message: AcceptedAgentUserMessage,
    saveModel: boolean,
  ): Effect.Effect<AcceptedMessagePlan, HostError> =>
    Effect.gen(function* () {
      const input: Parameters<WorkspaceSessionStorePort["recordAcceptedMessage"]>[0] = {
        ...known.ref,
        generatedTitle: buildWorkspaceSessionTitle(message),
        occurredAt: Date.parse(message.timestamp),
      };
      if (saveModel && message.model) {
        if (
          message.model.runtimeKind !== undefined &&
          message.model.runtimeKind !== runtimeRef.runtimeKind
        )
          return yield* Effect.fail(
            new HostValidationError({
              message: "Accepted message model does not match its Runtime.",
              field: "model",
            }),
          );
        input.selectedModel = { ...message.model, runtimeKind: runtimeRef.runtimeKind };
      }
      if (titleSyncNeedsTurn(runtimeRef.runtimeKind)) return { input, runtimeRename: null };
      const storedGeneratedTitle = known.session.generatedTitle ?? input.generatedTitle;
      const nextTitle = runtimeTitle({
        ...known.session,
        generatedTitle: storedGeneratedTitle,
      });
      const plannedRename = planRuntimeTitleRename(known.session, nextTitle);
      const runtimeRename =
        plannedRename === null
          ? null
          : {
              ...plannedRename,
              repoPath: known.ref.repoPath,
              runtimeKind: known.session.runtimeKind,
              workingDirectory: known.session.executionTarget.workingDirectory,
            };
      return { input, runtimeRename };
    });
  const renameRuntimeTitle = (
    input: AgentSessionControlUpdateTitleInput,
  ): Effect.Effect<void, HostError> =>
    updateRuntimeSessionTitle(input).pipe(
      Effect.flatMap((result) =>
        result.status === "renamed"
          ? Effect.void
          : Effect.fail(
              new HostOperationError({
                operation: "workspaceSession.accepted-message.rename",
                message:
                  "The runtime session is not attached. The title stays on its prior value. Rename the chat or send a message to sync the titles.",
              }),
            ),
      ),
    );
  const applyAcceptedMessage = (
    known: { ref: WorkspaceSessionStoreRef; session: WorkspaceSession },
    plan: AcceptedMessagePlan,
    runtimeRef: AgentSessionLiveRef,
  ) =>
    // After the native rename returns, shutdown waits for the save instead of stopping it.
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { input, runtimeRename } = plan;
        if (titleSyncNeedsTurn(runtimeRef.runtimeKind))
          return yield* restore(saveMessage(runtimeRef, known, input));
        // Rename before saving so a failed native rename leaves the saved title alone.
        if (runtimeRename !== null) {
          const renamed = yield* Effect.result(restore(renameRuntimeTitle(runtimeRename)));
          if (renamed._tag === "Failure") {
            const recorded = yield* Effect.result(
              storeEffect(store.recordAcceptedMessage({ ...input, generatedTitle: null })),
            );
            if (recorded._tag === "Failure") {
              return yield* Effect.fail(
                new HostOperationError({
                  operation: "workspaceSession.accepted-message.persist",
                  message: `${renamed.failure.message} Saving the accepted message also failed: ${recorded.failure.message}`,
                  cause: { runtimeFailure: renamed.failure, storeFailure: recorded.failure },
                }),
              );
            }
            yield* publishUpdated(known.ref.workspaceId, recorded.success);
            return yield* Effect.fail(renamed.failure);
          }
        }
        const saved = yield* Effect.result(storeEffect(store.recordAcceptedMessage(input)));
        if (saved._tag === "Failure") {
          if (runtimeRename === null) return yield* Effect.fail(saved.failure);
          return yield* Effect.fail(
            new HostOperationError({
              operation: "workspaceSession.accepted-message.persist",
              message: `${saved.failure.message} The runtime session keeps the generated title and the Workspace Session has no saved title. Rename the chat or send a message to sync the titles.`,
              cause: { storeFailure: saved.failure },
            }),
          );
        }
        yield* publishUpdated(known.ref.workspaceId, saved.success);
      }),
    );
  const recordAcceptedMessage = (
    runtimeRef: AgentSessionLiveRef,
    message: AcceptedAgentUserMessage,
    saveModel: boolean,
  ) =>
    Effect.gen(function* () {
      const located = yield* find(runtimeRef);
      if (!located) return;
      yield* sessionTitleGate.run(
        located.ref,
        Effect.gen(function* () {
          const known = yield* find(runtimeRef);
          if (!known) return;
          yield* applyAcceptedMessage(
            known,
            yield* planAcceptedMessage(known, runtimeRef, message, saveModel),
            runtimeRef,
          );
        }),
      );
    });
  const recordObservedMessage = (
    runtimeRef: AgentSessionLiveRef,
    message: AcceptedAgentUserMessage,
  ) =>
    Effect.gen(function* () {
      const known = yield* find(runtimeRef);
      if (!known) return;
      const plan = yield* planAcceptedMessage(known, runtimeRef, message, false);
      if (titleSyncNeedsTurn(runtimeRef.runtimeKind))
        return yield* saveMessage(runtimeRef, known, plan.input);
      // Defer observed renames because a manual rename can hold the gate during live publication.
      const renamePending = plan.runtimeRename !== null || sessionTitleGate.isActive(known.ref);
      const saved = yield* storeEffect(
        store.recordAcceptedMessage(
          renamePending ? { ...plan.input, generatedTitle: null } : plan.input,
        ),
      );
      const published = yield* Effect.result(publishUpdated(known.ref.workspaceId, saved));
      // Start the saved title's rename before a publication failure can stop it.
      if (renamePending && !sendsInFlight.has(agentSessionRefKey(runtimeRef)))
        yield* startJob(
          recordAcceptedMessage(runtimeRef, message, false).pipe(
            Effect.catch((failure) => reportRenameFailure(runtimeRef, failure.message)),
          ),
        );
      if (published._tag === "Failure") return yield* Effect.fail(published.failure);
    });
  const recordActivity = (runtimeRef: AgentSessionLiveRef, occurredAt: number) =>
    Effect.gen(function* () {
      const known = yield* find(runtimeRef);
      if (!known) return false;
      if (occurredAt > (known.session.lastActivityAt ?? known.session.createdAt)) {
        const saved = yield* storeEffect(
          store.recordActivity({
            ...known.ref,
            activity: { type: "session_activity", occurredAt },
          }),
        );
        yield* publishUpdated(known.ref.workspaceId, saved);
      }
      return true;
    });
  const validateRef = (runtimeRef: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      yield* findActive(runtimeRef);
    });
  const runOperation = <A, E, R>(
    runtimeRef: AgentSessionLiveRef,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostError, R> =>
    Effect.gen(function* () {
      const known = yield* find(runtimeRef);
      return yield* known ? operationGate.run(known.ref, effect) : effect;
    });
  return {
    shutdown: () => Scope.close(jobsScope, Exit.void),
    recordActivity,
    markTitleSyncPending: (ref) => {
      titleSync.set(agentSessionRefKey(ref), "pending");
    },
    isTitleSyncPending: (ref) => {
      const state = titleSync.get(agentSessionRefKey(ref));
      return state === "pending" || state === "queued";
    },
    run: (runtimeRef, operation, effect) => {
      if (operation !== "resume session" || runtimeRef.runtimeKind !== "codex")
        return runOperation(runtimeRef, effect);
      return Effect.suspend(() => {
        const key = agentSessionRefKey(runtimeRef);
        const previous = titleSync.get(key);
        return runOperation(runtimeRef, effect).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.sync(() => {
                  if (titleSync.get(key) !== "pending") return;
                  if (previous === undefined) titleSync.delete(key);
                  else titleSync.set(key, previous);
                })
              : Effect.void,
          ),
        );
      });
    },
    runSend: (runtimeRef, effect) =>
      runOperation(
        runtimeRef,
        Effect.sync(() => {
          // Do not rename from an observation while a send still runs.
          sendsInFlight.add(agentSessionRefKey(runtimeRef));
        }).pipe(
          Effect.andThen(effect),
          Effect.ensuring(
            Effect.sync(() => {
              sendsInFlight.delete(agentSessionRefKey(runtimeRef));
            }),
          ),
        ),
      ),
    prepareResume: (input) =>
      Effect.gen(function* () {
        const prepared = yield* prepare(input);
        if (
          prepared.runtimeKind === "codex" &&
          prepared.sessionScope.kind === "repository" &&
          prepared.resumeMode !== "continue_interrupted_turn" &&
          titleSync.get(agentSessionRefKey(prepared)) !== "queued"
        )
          titleSync.set(agentSessionRefKey(prepared), "pending");
        return {
          input: prepared,
          save: (summary: AgentSessionSummary) =>
            Effect.sync(() => {
              if (prepared.runtimeKind === "codex" && summary.firstTurnCompleted === true)
                titleSync.set(agentSessionRefKey(prepared), "handled");
            }),
        };
      }),
    prepareSend: prepare,
    validateRef,
    prepareModelUpdate: (input) =>
      Effect.gen(function* () {
        const known = yield* findActive(input);
        if (!known) return { input, previousModel: null, save: Effect.succeed(Effect.void) };
        if (input.model === null)
          return yield* Effect.fail(
            new HostValidationError({
              message: "Select a Model for this Workspace Session.",
              field: "model",
            }),
          );
        const model = input.model;
        return {
          input,
          previousModel: known.session.selectedModel,
          save: Effect.suspend(() =>
            storeEffect(
              store.setSelectedModel({
                ...known.ref,
                selectedModel: {
                  ...model,
                  runtimeKind: input.runtimeKind,
                  profileId: model.profileId ?? known.session.selectedModel?.profileId,
                },
              }),
            ),
          ).pipe(Effect.map((saved) => publishUpdated(known.ref.workspaceId, saved))),
        };
      }),
    recordAcceptedMessage: (ref, message) => recordAcceptedMessage(ref, message, true),
    observe: (envelope, provenance) =>
      Effect.gen(function* () {
        if (provenance === "baseline") return;
        if (envelope.type === "session_removed") {
          const key = agentSessionRefKey(envelope.ref);
          titleSync.delete(key);
          return;
        }
        if (envelope.type !== "transcript_event") return;
        const { event } = envelope;
        if (event.type === "user_message") {
          yield* recordObservedMessage(event.sessionRef, event);
        } else if (
          event.type === "session_idle" &&
          event.turnCompleted === true &&
          titleSyncNeedsTurn(event.sessionRef.runtimeKind)
        ) {
          yield* syncTitleAfterTurn(event.sessionRef, {
            state: titleSync,
            find,
            findActive,
            gate: sessionTitleGate,
            updateTitle: updateRuntimeSessionTitle,
            reportFailure: reportRenameFailure,
            startJob,
          });
        }
      }),
  };
};

const storeEffect = <A>(effect: Effect.Effect<A, TaskStoreError>): Effect.Effect<A, HostError> =>
  effect.pipe(
    Effect.mapError((cause) =>
      isHostError(cause)
        ? cause
        : new HostOperationError({
            operation: "workspaceSession.persist",
            message: cause.message,
            cause,
          }),
    ),
  );
