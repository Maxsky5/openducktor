import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSpeedReason,
  type AgentSessionControlUpdateSpeedInput,
  type AgentSessionModelSettings,
} from "@openducktor/contracts";
import { speedEligibility, initialSpeedState } from "@openducktor/core";
import { Effect } from "effect";
import {
  HostValidationError,
  toHostOperationError,
  type HostError,
} from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import { changeSessionSettings } from "./agent-session-settings-change";

/** Check the saved choice before work. Save imported choices and model resets while holding turn starts. */
export const prepareSavedSpeed = <
  Input extends {
    repoPath: string;
    runtimeKind: AgentSessionControlUpdateSpeedInput["runtimeKind"];
    workingDirectory: string;
    externalSessionId: string;
    sessionScope: AgentSessionControlUpdateSpeedInput["sessionScope"];
    model?: AgentSessionModelSettings | undefined;
    speed?: string | null | undefined;
  },
>(
  runtime: Pick<AgentSessionLiveStateService, "withSessionSettings">,
  input: Input,
  policy: AgentSessionOperationPolicy,
): Effect.Effect<Input, HostError> => {
  if (
    input.speed === null &&
    RUNTIME_DESCRIPTORS_BY_KIND[input.runtimeKind].capabilities.speed.support === "none"
  )
    return Effect.succeed(input);
  if (input.speed === null)
    return runtime
      .withSessionSettings(input, (adapter) =>
        Effect.gen(function* () {
          const read = yield* adapter.readSnapshot(input);
          const choice = read.type === "live" ? read.session.speed?.choice : null;
          if (choice === null || choice === undefined)
            return yield* new HostValidationError({
              field: "speed",
              message:
                "The native speed choice is unknown. Set speed before resuming or sending work.",
            });
          const saved = yield* policy.prepareSpeedUpdate({ ...input, speed: choice });
          yield* changeSessionSettings({
            adapter,
            ref: input,
            previous:
              read.type === "live" && read.session.speed
                ? { ...read.session.speed, choice: null }
                : initialSpeedState(null),
            choice,
            apply: Effect.succeed({ reportedChoice: choice }),
            restore: Effect.succeed({}),
            save: saved.save(choice),
          });
          return choice;
        }),
      )
      .pipe(
        Effect.flatMap((choice) => prepareSavedSpeed(runtime, { ...input, speed: choice }, policy)),
      );
  if (input.speed === undefined || input.speed === "standard") return Effect.succeed(input);
  const speed = input.speed;
  const ref = { ...input, speed };
  return runtime.withSessionSettings(ref, (adapter) =>
    Effect.gen(function* () {
      const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[input.runtimeKind];
      const read = yield* adapter.readSnapshot(ref);
      const previous =
        read.type === "live" && read.session.speed && read.session.speed.choice === speed
          ? read.session.speed
          : initialSpeedState(speed);
      const markUnapplied = (reason: AgentSpeedReason): Effect.Effect<void, HostError> =>
        adapter.setSessionSpeedState(ref, {
          ...previous,
          synchronization: "unapplied",
          reason,
        });
      const catalogReason = {
        code: "catalog_unavailable",
        message: "The model catalog could not load. Refresh it or select Standard.",
      };
      const catalog = yield* adapter.queries.loadRuntimeCatalog(ref).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "agent-session.restore-speed-catalog"),
        ),
        Effect.tapError(() => markUnapplied(catalogReason)),
      );
      if (!catalog.models || catalog.models.status === "failed") {
        yield* markUnapplied(catalogReason);
        return yield* new HostValidationError({
          field: "speed",
          message: catalogReason.message,
          cause: catalog.models?.status === "failed" ? catalog.models.cause : undefined,
        });
      }
      const eligibility = speedEligibility(
        descriptor,
        catalog.models.catalog,
        input.model ?? null,
        speed,
      );
      if (eligibility === "supported") return input;
      if (eligibility === "unknown") {
        const reason = {
          code: "model_support_unknown",
          message: "Speed support is unknown. Refresh the model list or select Standard.",
        };
        yield* markUnapplied(reason);
        return yield* new HostValidationError({
          field: "speed",
          message: reason.message,
        });
      }
      const saved = yield* policy.prepareSpeedUpdate({ ...ref, speed: "standard" });
      yield* changeSessionSettings({
        adapter,
        ref,
        previous,
        choice: "standard",
        apply: adapter.updateSessionSpeed({ ...ref, speed: "standard" }),
        restore: adapter.updateSessionSpeed(ref),
        save: saved.save("standard"),
      });
      return { ...input, speed: "standard" };
    }),
  );
};
