import {
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  type RuntimeRoute,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { createRetryableCleanup } from "../../effect/retryable-cleanup";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";

/** Builds and validates the summary of one runtime generation. */
export const createRuntimeSummary = (input: {
  kind: RuntimeKind;
  runtimeId: string;
  runtimeRoute: RuntimeRoute;
  descriptor: RuntimeDescriptor;
  startedAt: Date;
}): Effect.Effect<
  RuntimeInstanceSummary,
  HostValidationError<{ runtimeKind: RuntimeKind; runtimeId: string }>
> =>
  Effect.try({
    try: () =>
      runtimeInstanceSummarySchema.parse({
        kind: input.kind,
        runtimeId: input.runtimeId,
        runtimeRoute: input.runtimeRoute,
        startedAt: input.startedAt.toISOString(),
        descriptor: input.descriptor,
      } satisfies RuntimeInstanceSummary),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { runtimeKind: input.kind, runtimeId: input.runtimeId },
      }),
  });

export type LiveSessionAttachment = {
  /** Takes ownership of a prepared adapter. From now on `release` discards or releases it. */
  adopt(prepared: PreparedRuntimeLiveSessionAdapter): void;
  /**
   * Registers the adopted adapter, then starts its forwarding. Fails when the runtime process
   * closes meanwhile. A failure leaves the adapter to `release`.
   */
  attach: Effect.Effect<void, HostOperationErrorAggregate>;
  /**
   * Releases the live state of the runtime: it releases a registered adapter and discards one that
   * never registered. A success is final, and a failure stays retryable.
   */
  release: Effect.Effect<void, HostOperationErrorAggregate>;
};

/** Owns the live-session adapter of one starting runtime, from preparation to release. */
export const createLiveSessionAttachment = ({
  runtimeId,
  runtimeLabel,
  operationPrefix,
  lifecycle,
  isClosed,
  closeDescription,
}: {
  runtimeId: string;
  /** Names the runtime in errors, for example "OpenCode". */
  runtimeLabel: string;
  /** Prefixes operation names, for example "opencodeRuntime". */
  operationPrefix: string;
  lifecycle: Pick<RuntimeLiveSessionLifecyclePort, "registerRuntimeAdapter" | "releaseRuntime">;
  isClosed: () => boolean;
  closeDescription: () => string | null;
}): LiveSessionAttachment => {
  let prepared: PreparedRuntimeLiveSessionAdapter | null = null;
  let registered = false;
  // Set while an attach runs. A release waits for it, so it knows to release or discard, and it
  // also stops the forwarding that the attach starts.
  let attaching: Deferred.Deferred<void> | null = null;

  const failIfClosed = (step: string, operation: string) =>
    isClosed()
      ? Effect.fail(
          new HostOperationError({
            operation: `${operationPrefix}.${operation}`,
            message: `${runtimeLabel} process exited ${step}: ${closeDescription() ?? "process exited"}`,
            details: { runtimeId, closeDescription: closeDescription() },
          }),
        )
      : Effect.void;

  const requirePrepared = () => {
    if (prepared) return prepared;
    throw new Error(`${runtimeLabel} runtime ${runtimeId} has no adopted live-session adapter.`);
  };

  // Created on adopt. Before that, the runtime owns no live state.
  let releasePrepared: Effect.Effect<void, HostOperationErrorAggregate> | null = null;

  return {
    adopt: (next) => {
      prepared = next;
      releasePrepared = createRetryableCleanup(
        Effect.gen(function* () {
          if (attaching) yield* Deferred.await(attaching);
          yield* (
            registered ? lifecycle.releaseRuntime(runtimeId).pipe(Effect.asVoid) : next.discard()
          ).pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, `${operationPrefix}.releaseLiveSessionState`, {
                runtimeId,
              }),
            ),
          );
        }),
      );
    },
    attach: Effect.gen(function* () {
      const adapter = requirePrepared();
      yield* failIfClosed(
        "before its live-session adapter was registered",
        "registerLiveSessionAdapter",
      );
      const attached = Deferred.makeUnsafe<void>();
      attaching = attached;
      yield* Effect.gen(function* () {
        yield* lifecycle.registerRuntimeAdapter(adapter.adapter).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, `${operationPrefix}.registerLiveSessionAdapter`, {
              runtimeId,
            }),
          ),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              registered = Exit.isSuccess(exit);
            }),
          ),
        );
        yield* failIfClosed(
          "while its live-session adapter was being registered",
          "registerLiveSessionAdapter",
        );
        yield* adapter.startForwarding().pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, `${operationPrefix}.startLiveSessionForwarding`, {
              runtimeId,
            }),
          ),
        );
        yield* failIfClosed(
          "while live-session forwarding was starting",
          "startLiveSessionForwarding",
        );
      }).pipe(Effect.ensuring(Deferred.succeed(attached, undefined)));
    }),
    release: Effect.suspend(() => releasePrepared ?? Effect.void),
  };
};
