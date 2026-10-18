import type { PreparedSessionModelUpdate } from "./agent-session-operation-policy";
import type {
  AgentSessionControlResumeInput,
  AgentSessionLiveSnapshot,
  AgentSessionModelSelection,
  AgentSessionLiveRef,
  AgentSessionLiveEnvelope,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Deferred, Effect, Exit } from "effect";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { createSessionOperationOwner } from "./session-operation-owner";
import type { createSessionTurnPreparation } from "./session-turn-preparation";

/** Model stages run under the command owner's existing permit and lifetime. */
export const createSessionModelPreparation = ({
  owner,
  runtime,
  turnPreparation,
}: {
  owner: ReturnType<typeof createSessionOperationOwner>;
  runtime: Pick<AgentSessionLiveStateService, "updateSessionModel" | "read">;
  turnPreparation: ReturnType<typeof createSessionTurnPreparation>;
}) => {
  const idleWaiters = new Map<
    string,
    { ref: AgentSessionLiveRef; waiter: Deferred.Deferred<void, HostError> }
  >();
  const waitForIdle = (ref: AgentSessionLiveRef): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const key = agentSessionRefKey(ref);
      const guarded = yield* owner.options();
      const assertCurrent = Effect.try({
        try: () => guarded.assertCurrent?.(),
        catch: (cause) =>
          new HostValidationError({
            field: "model",
            message: "Stop canceled the pending settings change.",
            cause,
          }),
      });
      yield* assertCurrent;
      const waiter = Deferred.makeUnsafe<void, HostError>();
      idleWaiters.set(key, { ref, waiter });
      const { repoPath, runtimeKind, workingDirectory, externalSessionId } = ref;
      yield* runtime.read({ repoPath, runtimeKind, workingDirectory, externalSessionId }).pipe(
        Effect.flatMap((live) => {
          if (live.type !== "live")
            return new HostValidationError({
              field: "externalSessionId",
              message: "The session is not attached. Reopen it before changing its settings.",
            });
          return live.session.activity === "running" || live.session.activity === "retrying"
            ? Deferred.await(waiter)
            : Effect.void;
        }),
        Effect.andThen(assertCurrent),
        Effect.ensuring(Effect.sync(() => idleWaiters.delete(key))),
      );
    });
  const cancel = (ref: AgentSessionLiveRef): void => {
    const waiter = idleWaiters.get(agentSessionRefKey(ref))?.waiter;
    if (waiter)
      Deferred.doneUnsafe(
        waiter,
        Exit.fail(
          new HostValidationError({
            field: "model",
            message:
              "Stop canceled the pending settings change. Select the settings again when the session is idle.",
          }),
        ),
      );
  };
  const observe = (change: AgentSessionLiveEnvelope): void => {
    if (change.type === "snapshot") {
      const sessions = new Map(
        change.sessions.map((session) => [agentSessionRefKey(session.ref), session]),
      );
      for (const [key, pending] of idleWaiters) {
        if (pending.ref.repoPath !== change.repoPath) continue;
        const session = sessions.get(key);
        if (session) observe({ type: "session_upsert", session });
        else observe({ type: "session_removed", ref: pending.ref });
      }
      return;
    }
    if (change.type !== "session_upsert" && change.type !== "session_removed") return;
    const ref = change.type === "session_upsert" ? change.session.ref : change.ref;
    const waiter = idleWaiters.get(agentSessionRefKey(ref))?.waiter;
    if (!waiter) return;
    if (change.type === "session_removed") {
      Deferred.doneUnsafe(
        waiter,
        Exit.fail(
          new HostValidationError({
            field: "externalSessionId",
            message: "The session stopped before its settings could change. Reopen it and retry.",
          }),
        ),
      );
    } else if (change.session.activity === "idle") {
      Deferred.doneUnsafe(waiter, Exit.void);
    }
  };
  const continuationModel = (
    input: AgentSessionControlResumeInput,
    live: AgentSessionLiveSnapshot | undefined,
  ) =>
    Effect.gen(function* () {
      const root = yield* owner.root(input);
      const child = agentSessionRefKey(root) !== agentSessionRefKey(input);
      let selected: AgentSessionModelSelection | null = input.model
        ? { ...input.model, runtimeKind: input.runtimeKind }
        : null;
      if (child) {
        if (!live?.model)
          return yield* new HostValidationError({
            field: "model",
            message:
              "The selected child's current model is unknown. Reload its runtime state before continuing the interrupted turn.",
          });
        selected = { ...live.model, runtimeKind: live.model.runtimeKind ?? input.runtimeKind };
      }
      return yield* turnPreparation.model(input, selected);
    });

  const updateModel = (prepared: PreparedSessionModelUpdate) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const guarded = yield* owner.options("model");
        yield* owner.modelChanged(
          prepared.input.model
            ? { ...prepared.input.model, runtimeKind: prepared.input.runtimeKind }
            : null,
          "unresolved",
        );
        const native = yield* Effect.result(
          runtime.updateSessionModel({
            ...prepared.input,
            workStartGuard: guarded.assertCurrent
              ? { assertCurrent: guarded.assertCurrent }
              : undefined,
            onWorkIssued: guarded.onSent,
            onWorkAccepted: guarded.onAccepted,
          }),
        );
        if (native._tag === "Success") {
          guarded.onAccepted();
        }
        if (native._tag === "Failure" && !guarded.wasAccepted())
          return yield* Effect.fail(native.failure);
        const saved = yield* Effect.result(prepared.save);
        if (saved._tag === "Success") {
          yield* owner.modelChanged(
            prepared.input.model
              ? { ...prepared.input.model, runtimeKind: prepared.input.runtimeKind }
              : null,
            "committed",
          );
          yield* saved.success;
          if (native._tag === "Failure") return yield* Effect.fail(native.failure);
          return;
        }
        const restored = yield* Effect.result(
          runtime.updateSessionModel({
            ...prepared.input,
            model: prepared.previousModel,
            workStartGuard: guarded.assertCurrent
              ? { assertCurrent: guarded.assertCurrent }
              : undefined,
          }),
        );
        if (restored._tag === "Failure") {
          yield* owner.modelChanged(
            prepared.input.model
              ? { ...prepared.input.model, runtimeKind: prepared.input.runtimeKind }
              : null,
            "unresolved",
          );
          return yield* new HostOperationError({
            operation: "agent-session.update-model",
            message: `${saved.failure.message} Runtime model restore failed: ${restored.failure.message}`,
            cause: { storeFailure: saved.failure, restoreFailure: restored.failure },
            details: {
              ref: prepared.input,
              storeFailure: saved.failure,
              restoreFailure: restored.failure,
            },
          });
        }
        yield* owner.modelChanged(
          prepared.previousModel
            ? { ...prepared.previousModel, runtimeKind: prepared.input.runtimeKind }
            : null,
          "restored",
        );
        return yield* Effect.fail(saved.failure);
      }),
    );

  return { continuationModel, updateModel, waitForIdle, observe, cancel };
};
