import type {
  AcceptedAgentUserMessage,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveRef,
  WorkspaceSession,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import {
  buildWorkspaceSessionTitle,
  runtimeTitleFor,
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
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";

export type WorkspaceSessionUpdatedPublisher = (
  workspaceId: string,
  session: WorkspaceSession,
) => Effect.Effect<void, HostError>;

export type WorkspaceSessionRuntimeTitleUpdater = (
  input: AgentSessionControlUpdateTitleInput,
) => Effect.Effect<void, HostError>;

export type WorkspaceSessionRenameFailureReporter = (
  runtimeRef: AgentSessionLiveRef,
  message: string,
) => Effect.Effect<void>;

type AcceptedMessagePlan = {
  input: Parameters<WorkspaceSessionStorePort["recordAcceptedMessage"]>[0];
  runtimeRename: AgentSessionControlUpdateTitleInput | null;
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
}): AgentSessionPersistencePort & AgentSessionOperationPolicy => {
  const pendingFinalMessages = new Map<string, { messageId: string; occurredAt: number }>();
  const sendsInFlight = new Set<string>();
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
      const runtimeTitle = runtimeTitleFor(known.session);
      const prepared = {
        ...input,
        sessionScope:
          runtimeTitle === null
            ? input.sessionScope
            : { kind: "repository" as const, title: runtimeTitle },
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
      const storedGeneratedTitle = known.session.generatedTitle ?? input.generatedTitle;
      const runtimeTitle = runtimeTitleFor({
        ...known.session,
        generatedTitle: storedGeneratedTitle,
      });
      const previousTitle = runtimeTitleFor(known.session);
      const runtimeRename =
        known.session.externalSessionId !== null &&
        runtimeTitle !== null &&
        runtimeTitle !== previousTitle
          ? {
              externalSessionId: known.session.externalSessionId,
              repoPath: known.ref.repoPath,
              runtimeKind: known.session.runtimeKind,
              workingDirectory: known.session.executionTarget.workingDirectory,
              title: runtimeTitle,
            }
          : null;
      return { input, runtimeRename };
    });
  const applyAcceptedMessage = (
    known: { ref: WorkspaceSessionStoreRef; session: WorkspaceSession },
    plan: AcceptedMessagePlan,
  ) =>
    Effect.gen(function* () {
      const { input, runtimeRename } = plan;
      // Rename the runtime session before the durable write, so a failed rename never
      // stores a title that the runtime session does not show.
      if (runtimeRename !== null) {
        const renamed = yield* Effect.either(updateRuntimeSessionTitle(runtimeRename));
        if (renamed._tag === "Left") {
          // Keep the accepted-message activity, but leave the title on its prior value.
          const recorded = yield* Effect.either(
            storeEffect(store.recordAcceptedMessage({ ...input, generatedTitle: null })),
          );
          if (recorded._tag === "Left") {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "workspaceSession.accepted-message.persist",
                message: `${renamed.left.message} Saving the accepted message also failed: ${recorded.left.message}`,
                cause: { runtimeFailure: renamed.left, storeFailure: recorded.left },
              }),
            );
          }
          yield* publishUpdated(known.ref.workspaceId, recorded.right);
          return yield* Effect.fail(renamed.left);
        }
      }
      const saved = yield* Effect.either(storeEffect(store.recordAcceptedMessage(input)));
      if (saved._tag === "Left") {
        if (runtimeRename === null) return yield* Effect.fail(saved.left);
        return yield* Effect.fail(
          new HostOperationError({
            operation: "workspaceSession.accepted-message.persist",
            message: `${saved.left.message} The runtime session keeps the generated title and the Workspace Session has no saved title. Rename the chat or send a message to sync the titles.`,
            cause: { storeFailure: saved.left },
          }),
        );
      }
      yield* publishUpdated(known.ref.workspaceId, saved.right);
    });
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
      const renamePending = plan.runtimeRename !== null;
      // A runtime rename cannot run inside the live publication scopes, because the
      // runtime holds its lock until the publication ends. A send completes the rename
      // after the runtime call returns; every other observation defers it to a fiber.
      const saved = yield* storeEffect(
        store.recordAcceptedMessage(
          renamePending ? { ...plan.input, generatedTitle: null } : plan.input,
        ),
      );
      yield* publishUpdated(known.ref.workspaceId, saved);
      if (renamePending && !sendsInFlight.has(agentSessionRefKey(runtimeRef)))
        yield* Effect.forkDaemon(
          recordAcceptedMessage(runtimeRef, message, false).pipe(
            Effect.catchAll((failure) => reportRenameFailure(runtimeRef, failure.message)),
          ),
        );
    });
  const flushFinalMessage = (runtimeRef: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const key = agentSessionRefKey(runtimeRef);
      const pending = pendingFinalMessages.get(key);
      if (!pending) return;
      const known = yield* find(runtimeRef);
      if (known && pending.occurredAt > known.session.updatedAt) {
        const saved = yield* storeEffect(
          store.recordActivity({
            ...known.ref,
            activity: { type: "assistant_response", occurredAt: pending.occurredAt },
          }),
        );
        yield* publishUpdated(known.ref.workspaceId, saved);
      }
      pendingFinalMessages.delete(key);
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
    run: (runtimeRef, _operation, effect) => runOperation(runtimeRef, effect),
    runSend: (runtimeRef, effect) =>
      runOperation(
        runtimeRef,
        Effect.sync(() => {
          // A send renames the runtime session after the runtime call returns, so an
          // observation during the send must not start a background rename.
          sendsInFlight.add(agentSessionRefKey(runtimeRef));
        }).pipe(
          Effect.zipRight(effect),
          Effect.ensuring(
            Effect.sync(() => {
              sendsInFlight.delete(agentSessionRefKey(runtimeRef));
            }),
          ),
        ),
      ),
    prepareResume: (input) =>
      prepare(input).pipe(
        Effect.map((prepared) => ({
          input: prepared,
          save: () => Effect.void,
        })),
      ),
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
    observe: (envelope) =>
      Effect.gen(function* () {
        if (envelope.type === "session_removed") {
          pendingFinalMessages.delete(agentSessionRefKey(envelope.ref));
          return;
        }
        if (envelope.type === "session_upsert") {
          if (envelope.session.activity === "idle") yield* flushFinalMessage(envelope.session.ref);
          return;
        }
        if (envelope.type !== "transcript_event") return;
        const { event } = envelope;
        const key = agentSessionRefKey(event.sessionRef);
        if (event.type === "user_message") {
          yield* recordObservedMessage(event.sessionRef, event);
        } else if (event.type === "assistant_message") {
          if (yield* find(event.sessionRef)) {
            const occurredAt = Date.parse(event.timestamp);
            const previous = pendingFinalMessages.get(key);
            if (!previous || occurredAt > previous.occurredAt)
              pendingFinalMessages.set(key, { messageId: event.messageId, occurredAt });
          }
        } else if (event.type === "transcript_retracted") {
          const pending = pendingFinalMessages.get(key);
          if (pending && event.messageIds.includes(pending.messageId))
            pendingFinalMessages.delete(key);
        } else if (
          event.type === "session_idle" ||
          (event.type === "session_status" && event.status.type === "idle")
        ) {
          yield* flushFinalMessage(event.sessionRef);
        }
      }),
  };
};
