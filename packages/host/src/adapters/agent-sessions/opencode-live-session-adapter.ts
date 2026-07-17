import {
  createPrepareOpencodeSessionRuntime,
  type OpencodeSessionRuntimeSignal,
  type PrepareOpencodeSessionRuntime,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionLiveRef,
  agentSessionTranscriptEventSchema,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import { refKey, requireRuntime, toSessionRef } from "./opencode-live-session-normalization";
import { createOpenCodeLiveSessionState } from "./opencode-live-session-state";
import { createOpenCodeSessionControlAdapter } from "./opencode-session-control-adapter";

export type OpenCodeLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedRuntimeLiveSessionAdapter, HostError>;

export type CreateOpenCodeLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<
    RuntimeLiveSessionLifecyclePort,
    "releaseRuntime" | "runAdapterMutation"
  >;
  readonly prepareRuntime?: PrepareOpencodeSessionRuntime;
};

const stateEffect = <Value>(
  operation: string,
  run: () => Value,
  details: Record<string, unknown>,
): Effect.Effect<Value, HostError> =>
  Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : toHostOperationError(cause, operation, details),
  });

export const createOpenCodeLiveSessionAdapterPreparer = ({
  liveSessionLifecycle,
  prepareRuntime = createPrepareOpencodeSessionRuntime(),
}: CreateOpenCodeLiveSessionAdapterPreparerInput): OpenCodeLiveSessionAdapterPreparer => {
  let nextOccurrence = 1;

  return (runtimeInput) =>
    Effect.gen(function* () {
      const runtime = yield* requireRuntime(runtimeInput);
      const prepared = yield* Effect.tryPromise({
        try: (signal) =>
          prepareRuntime({
            repoPath: runtime.repoPath,
            runtimeId: runtime.runtimeId,
            runtimeEndpoint: runtime.runtimeRoute.endpoint,
            signal,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "opencode-live-session.prepare-runtime", {
            runtimeId: runtime.runtimeId,
            repoPath: runtime.repoPath,
          }),
      });
      const state = createOpenCodeLiveSessionState({
        runtime,
        nextOccurrenceId: () => `opencode-pending-${nextOccurrence++}`,
      });
      yield* Effect.tryPromise({
        try: async () => {
          try {
            state.initialize(prepared.initialSources, prepared.initialContextUsageBySessionId);
          } catch (cause) {
            try {
              await prepared.release();
            } catch (cleanupCause) {
              throw new AggregateError(
                [cause, cleanupCause],
                `Failed to initialize and release OpenCode runtime '${runtime.runtimeId}'.`,
              );
            }
            throw cause;
          }
        },
        catch: (cause) =>
          toHostOperationError(cause, "opencode-live-session.initialize-state", {
            runtimeId: runtime.runtimeId,
          }),
      });

      const runtimeSemaphore = Effect.unsafeMakeSemaphore(1);
      const serializeRuntime = runtimeSemaphore.withPermits(1);
      const contextLoads = new Map<string, Promise<AgentSessionContextUsage | null>>();
      let released = false;

      const requireActive = (): void => {
        if (released) {
          throw new HostOperationError({
            operation: "opencode-live-session.require-active",
            message: `OpenCode runtime '${runtime.runtimeId}' has been released.`,
            details: { runtimeId: runtime.runtimeId },
          });
        }
      };

      const commit = <Value>(
        operation: string,
        mutation: () => AgentSessionLiveAdapterMutation<Value>,
      ): Effect.Effect<Value, HostError> =>
        liveSessionLifecycle.runAdapterMutation(
          stateEffect(
            operation,
            () => {
              requireActive();
              return mutation();
            },
            { runtimeId: runtime.runtimeId },
          ),
        );

      const controls = createOpenCodeSessionControlAdapter({
        runtime,
        connection: prepared.connection,
        state,
        serializeRuntime,
        commit,
      });

      const refreshProjection = (): Effect.Effect<void, HostError> =>
        serializeRuntime(
          Effect.tryPromise({
            try: () => prepared.connection.readSessionSources(),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.refresh-sessions", {
                runtimeId: runtime.runtimeId,
              }),
          }).pipe(
            Effect.flatMap((sources) =>
              commit("opencode-live-session.commit-refresh", () => ({
                value: undefined,
                changes: state.refresh(sources),
              })),
            ),
          ),
        );

      const handleSignal = (
        signal: OpencodeSessionRuntimeSignal,
      ): Effect.Effect<void, HostError> => {
        switch (signal.type) {
          case "sessions_invalidated":
            return refreshProjection();
          case "context_updated":
            return serializeRuntime(
              commit("opencode-live-session.commit-context", () => ({
                value: undefined,
                changes: state.retainContext(signal.externalSessionId, signal.contextUsage),
              })),
            );
          case "transcript_event":
            return serializeRuntime(
              commit("opencode-live-session.commit-transcript-event", () => {
                const ref = state.refForExternalSession(signal.externalSessionId);
                if (!ref) {
                  return { value: undefined, changes: [] };
                }
                const event = agentSessionTranscriptEventSchema.parse({
                  ...signal.event,
                  sessionRef: ref,
                });
                return {
                  value: undefined,
                  changes: [{ type: "transcript_event", event }],
                };
              }),
            );
          case "fault":
            return serializeRuntime(
              commit("opencode-live-session.commit-fault", () => ({
                value: undefined,
                changes: [
                  {
                    type: "fault",
                    repoPath: runtime.repoPath,
                    operation: "opencode-live-session.observe-runtime",
                    message: signal.message,
                  },
                ],
              })),
            ).pipe(
              Effect.flatMap(() =>
                liveSessionLifecycle.releaseRuntime(runtime.runtimeId).pipe(Effect.asVoid),
              ),
            );
        }
      };

      const loadMissingContext = (
        input: AgentSessionLiveLoadContextInput,
      ): Promise<AgentSessionContextUsage | null> => {
        const operation = Effect.tryPromise({
          try: () => prepared.connection.loadContextUsage(toSessionRef(input)),
          catch: (cause) =>
            toHostOperationError(cause, "opencode-live-session.load-context", {
              runtimeId: runtime.runtimeId,
              externalSessionId: input.externalSessionId,
            }),
        }).pipe(
          Effect.flatMap((contextUsage) =>
            serializeRuntime(
              commit("opencode-live-session.commit-loaded-context", () =>
                state.applyLoadedContext(input, contextUsage),
              ),
            ),
          ),
        );
        return Effect.runPromise(operation);
      };

      const releaseAdapter = (): Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError> =>
        serializeRuntime(
          Effect.suspend(() => {
            if (released) {
              return Effect.succeed([]);
            }
            released = true;
            contextLoads.clear();
            return Effect.gen(function* () {
              const refs = state.release();
              yield* Effect.tryPromise({
                try: () => prepared.release(),
                catch: (cause) =>
                  toHostOperationError(cause, "opencode-live-session.release-runtime", {
                    runtimeId: runtime.runtimeId,
                  }),
              });
              return refs;
            });
          }),
        );

      const adapter: AgentSessionRuntimeAdapterPort = {
        binding: {
          runtimeId: runtime.runtimeId,
          runtimeKind: runtime.kind,
          repoPath: runtime.repoPath,
        },
        matches: (ref) => !released && state.has(ref),
        listRetainedSnapshots: (repoPath) =>
          repoPath === runtime.repoPath
            ? stateEffect("opencode-live-session.list-retained-snapshots", state.listSnapshots, {
                runtimeId: runtime.runtimeId,
              })
            : Effect.succeed([]),
        readRetainedSnapshot: (ref) =>
          stateEffect(
            "opencode-live-session.read-retained-snapshot",
            () => state.readSnapshot(ref),
            { runtimeId: runtime.runtimeId, externalSessionId: ref.externalSessionId },
          ),
        loadContext: (input) =>
          Effect.suspend(() => {
            const retained = state.contextUsage(input);
            if (retained) {
              return Effect.succeed(retained);
            }
            const key = refKey(input);
            const existing = contextLoads.get(key);
            if (existing) {
              return Effect.tryPromise({
                try: () => existing,
                catch: (cause) =>
                  toHostOperationError(cause, "opencode-live-session.load-context", {
                    runtimeId: runtime.runtimeId,
                    externalSessionId: input.externalSessionId,
                  }),
              });
            }
            const load = loadMissingContext(input).finally(() => {
              contextLoads.delete(key);
            });
            contextLoads.set(key, load);
            return Effect.tryPromise({
              try: () => load,
              catch: (cause) =>
                toHostOperationError(cause, "opencode-live-session.load-context", {
                  runtimeId: runtime.runtimeId,
                  externalSessionId: input.externalSessionId,
                }),
            });
          }),
        replyApproval: (input) =>
          serializeRuntime(
            stateEffect(
              "opencode-live-session.resolve-approval-route",
              () => state.requirePendingRoute(input, input.requestId, "approval"),
              {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
              },
            ).pipe(
              Effect.flatMap((route) =>
                Effect.tryPromise({
                  try: () =>
                    prepared.connection.replyApproval({
                      ref: route.ref,
                      nativeRequestId: route.nativeRequestId,
                      outcome: input.outcome,
                      ...(input.message ? { message: input.message } : {}),
                    }),
                  catch: (cause) =>
                    toHostOperationError(cause, "opencode-live-session.reply-approval", {
                      runtimeId: runtime.runtimeId,
                      externalSessionId: input.externalSessionId,
                      requestId: input.requestId,
                    }),
                }).pipe(
                  Effect.flatMap(() =>
                    commit("opencode-live-session.commit-approval-reply", () => ({
                      value: undefined,
                      changes: state.completePendingReply(route),
                    })),
                  ),
                ),
              ),
            ),
          ),
        replyQuestion: (input) =>
          serializeRuntime(
            stateEffect(
              "opencode-live-session.resolve-question-route",
              () => state.requirePendingRoute(input, input.requestId, "question"),
              {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
              },
            ).pipe(
              Effect.flatMap((route) =>
                Effect.tryPromise({
                  try: () =>
                    prepared.connection.replyQuestion({
                      ref: route.ref,
                      nativeRequestId: route.nativeRequestId,
                      answers: input.answers,
                    }),
                  catch: (cause) =>
                    toHostOperationError(cause, "opencode-live-session.reply-question", {
                      runtimeId: runtime.runtimeId,
                      externalSessionId: input.externalSessionId,
                      requestId: input.requestId,
                    }),
                }).pipe(
                  Effect.flatMap(() =>
                    commit("opencode-live-session.commit-question-reply", () => ({
                      value: undefined,
                      changes: state.completePendingReply(route),
                    })),
                  ),
                ),
              ),
            ),
          ),
        releaseRuntime: releaseAdapter,
        ...controls,
      };

      return {
        adapter,
        startForwarding: () =>
          Effect.tryPromise({
            try: () =>
              prepared.startForwarding((signal) => Effect.runPromise(handleSignal(signal))),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.start-forwarding", {
                runtimeId: runtime.runtimeId,
              }),
          }),
        discard: () => releaseAdapter().pipe(Effect.asVoid),
      } satisfies PreparedRuntimeLiveSessionAdapter;
    });
};
