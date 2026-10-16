import type {
  AgentSessionOperationPolicy,
  AgentSessionSendContent,
  PreparedSessionModelUpdate,
} from "./agent-session-operation-policy";
import type {
  AgentSessionControlResumeInput,
  AgentSessionLiveSnapshot,
  AgentSessionModelSelection,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
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
  runtime: Pick<AgentSessionLiveStateService, "updateSessionModel">;
  turnPreparation: ReturnType<typeof createSessionTurnPreparation>;
}) => {
  const prepareModel = (
    input: AgentSessionSendContent,
    policy: AgentSessionOperationPolicy,
    steering = false,
  ) =>
    Effect.gen(function* () {
      if (steering) {
        yield* turnPreparation.steeringContent(input, input.parts);
        return input;
      }
      const decision = yield* turnPreparation.model(
        input,
        input.model ? { ...input.model, runtimeKind: input.runtimeKind } : null,
        { captured: input.modelCaptured === true, parts: input.parts },
      );
      if (decision.kind === "repair") {
        const prepared = yield* policy.prepareModelUpdate({ ...input, model: decision.selection });
        yield* updateModel(prepared);
      }
      return { ...input, model: decision.selection ?? undefined };
    });

  const prepareContinuationModel = (
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
      const decision = yield* turnPreparation.model(input, selected, { captured: true });
      return { ...input, model: decision.selection ?? undefined };
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

  return { prepareModel, prepareContinuationModel, updateModel };
};
