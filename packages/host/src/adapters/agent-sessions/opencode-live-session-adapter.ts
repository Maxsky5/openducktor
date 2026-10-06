import { createRuntimeSessionImportAdapter } from "./runtime-session-import-adapter";
import { createRuntimeQueryAdapter } from "./runtime-query-adapter";
import {
  unsupportedGeneratedImageSource,
  unsupportedGeneratedImageOperations,
} from "./generated-image-unsupported";
import {
  type OpencodeSessionRuntimeSignal,
  type PrepareOpencodeSessionRuntime,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionAuthorizedRoot,
  agentSessionTranscriptEventSchema,
  isAgentSessionTranscriptEventType,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  type HostErrorDetails,
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
import { createOpenCodeAdapterRelease } from "./opencode-live-session-release";
import { createOpenCodeLiveSessionState } from "./opencode-live-session-state";
import { createOpenCodeSessionControlAdapter } from "./opencode-session-control-adapter";
import { createSerialLane } from "../../effect/serial-gate";

export type PreparedOpenCodeLiveSessionAdapter = Omit<
  PreparedRuntimeLiveSessionAdapter,
  "adapter"
> & {
  readonly adapter: AgentSessionRuntimeAdapterPort;
};

/** Receives the loss of live observation before release, and a later failed release. */
export type OpenCodeLiveSessionObserver = {
  readonly onObservationLost: (message: string) => void;
  readonly onCleanupFailed: (message: string) => void;
};

export type OpenCodeLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
  observer: OpenCodeLiveSessionObserver,
) => Effect.Effect<PreparedRuntimeLiveSessionAdapter, HostError>;

export type OpenCodeRuntimeSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
  observer: OpenCodeLiveSessionObserver,
) => Effect.Effect<PreparedOpenCodeLiveSessionAdapter, HostError>;

export type CreateOpenCodeLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<
    RuntimeLiveSessionLifecyclePort,
    "releaseRuntime" | "createRuntimeRegistration"
  >;
  readonly prepareRuntime: PrepareOpencodeSessionRuntime;
};

const stateEffect = <Value, Details extends object>(
  operation: string,
  run: () => Value,
  details: HostErrorDetails<Details>,
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
  prepareRuntime,
}: CreateOpenCodeLiveSessionAdapterPreparerInput): OpenCodeRuntimeSessionAdapterPreparer => {
  let nextOccurrence = 1;

  return (runtimeInput, observer) =>
    Effect.gen(function* () {
      const runtime = yield* requireRuntime(runtimeInput);
      const prepared = yield* Effect.tryPromise({
        try: (signal) =>
          prepareRuntime({
            runtimeId: runtime.runtimeId,
            runtimeEndpoint: runtime.runtimeRoute.endpoint,
            signal,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "opencode-live-session.prepare-runtime", {
            runtimeId: runtime.runtimeId,
          }),
      });
      const state = createOpenCodeLiveSessionState({
        runtime,
        nextOccurrenceId: () => `opencode-pending-${nextOccurrence++}`,
      });
      const runtimeLane = createSerialLane();
      const binding = liveSessionLifecycle.createRuntimeRegistration({
        runtimeId: runtime.runtimeId,
        runtimeKind: runtime.kind,
      });
      const serializeRuntime = runtimeLane.run;
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
        binding.runMutation(
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

      const refreshSnapshots = (
        repoPath: string,
        roots?: AgentSessionAuthorizedRoot[],
      ): Effect.Effect<void, HostError> =>
        Effect.gen(function* () {
          const readVersions = state.versions();
          const readEffect = Effect.tryPromise({
            try: () => prepared.connection.readSessionSources(repoPath, roots),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.refresh-snapshots", {
                runtimeId: runtime.runtimeId,
                repoPath,
              }),
          });
          const read = yield* roots ? serializeRuntime(readEffect) : readEffect;
          yield* serializeRuntime(
            commit("opencode-live-session.commit-refreshed-snapshots", () => ({
              value: undefined,
              changes: state.applySessionSources(repoPath, read, readVersions),
            })),
          );
        });

      const handleSignal = (
        signal: OpencodeSessionRuntimeSignal,
      ): Effect.Effect<void, HostError> => {
        switch (signal.type) {
          case "context_updated":
            return serializeRuntime(
              commit("opencode-live-session.commit-context", () => ({
                value: undefined,
                changes: state.setContext(signal.externalSessionId, signal.contextUsage),
              })),
            );
          case "session_event":
            return serializeRuntime(
              commit("opencode-live-session.commit-transcript-event", () => {
                const ref = state.refForExternalSession(signal.externalSessionId);
                if (!ref) {
                  return { value: undefined, changes: [] };
                }
                const stateChanges = state.applyEvent(ref, signal.event);
                if (!isAgentSessionTranscriptEventType(signal.event.type)) {
                  return { value: undefined, changes: stateChanges };
                }
                const event = agentSessionTranscriptEventSchema.parse({
                  ...signal.event,
                  sessionRef: ref,
                });
                return {
                  value: undefined,
                  changes: [...stateChanges, { type: "transcript_event", event }],
                };
              }),
            );
          case "session_removed":
            return serializeRuntime(
              commit("opencode-live-session.commit-session-removal", () => {
                const ref = state.refForExternalSession(signal.externalSessionId);
                return {
                  value: undefined,
                  changes: ref ? state.removeSession(ref) : [],
                };
              }),
            );
          case "fault":
            // The route is unavailable from the fault on, before the release completes. The fault
            // reaches each repository with live sessions. The runtime status reports it too.
            observer.onObservationLost(signal.message);
            return serializeRuntime(
              commit("opencode-live-session.commit-fault", () => ({
                value: undefined,
                changes: [
                  ...new Set(state.listSnapshots().map((snapshot) => snapshot.ref.repoPath)),
                ].map((repoPath) => ({
                  type: "fault" as const,
                  repoPath,
                  operation: "opencode-live-session.observe-runtime",
                  message: signal.message,
                })),
              })),
            ).pipe(
              Effect.flatMap(() =>
                liveSessionLifecycle.releaseRuntime(runtime.runtimeId).pipe(
                  Effect.asVoid,
                  Effect.tapError((cause) =>
                    Effect.sync(() => observer.onCleanupFailed(cause.message)),
                  ),
                ),
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

      const releaseAdapter = serializeRuntime(
        createOpenCodeAdapterRelease({
          runtimeId: runtime.runtimeId,
          close: () => {
            released = true;
            contextLoads.clear();
            return state.release();
          },
          releaseNative: () => prepared.release(),
        }),
      );

      const adapter: AgentSessionRuntimeAdapterPort = {
        sessionImport: createRuntimeSessionImportAdapter({
          ...prepared.sessionImport,
          inspectSession: async (ref) => {
            const source = await prepared.sessionImport.inspectSession(ref);
            return {
              ...source,
              attach: async () => {
                await source.attach();
                await Effect.runPromise(refreshSnapshots(ref.repoPath));
              },
            };
          },
        }),
        queries: createRuntimeQueryAdapter(prepared.queries),
        ...unsupportedGeneratedImageOperations,
        resolveGeneratedImageSource: unsupportedGeneratedImageSource,
        supportsSessionControl: true,
        binding,
        refreshSnapshots,
        listSnapshots: () =>
          stateEffect("opencode-live-session.list-snapshots", state.listSnapshots, {
            runtimeId: runtime.runtimeId,
          }),
        readSnapshot: (ref) =>
          stateEffect("opencode-live-session.read-snapshot", () => state.readSnapshot(ref), {
            runtimeId: runtime.runtimeId,
            externalSessionId: ref.externalSessionId,
          }),
        loadContext: (input) =>
          Effect.suspend(() => {
            const usage = state.contextUsage(input);
            if (usage) {
              return Effect.succeed(usage);
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
              () => {
                const route = state.requirePendingRoute(input, input.requestId, "approval");
                state.assertApprovalAllowed(route, input.outcome);
                return route;
              },
              {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
              },
            ).pipe(
              Effect.flatMap((route) =>
                Effect.tryPromise({
                  try: () => {
                    const request: Parameters<typeof prepared.connection.replyApproval>[0] =
                      input.message
                        ? {
                            ref: route.ref,
                            nativeRequestId: route.nativeRequestId,
                            outcome: input.outcome,
                            message: input.message,
                          }
                        : {
                            ref: route.ref,
                            nativeRequestId: route.nativeRequestId,
                            outcome: input.outcome,
                          };
                    return prepared.connection.replyApproval(request);
                  },
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
        releaseRuntime: () => releaseAdapter,
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
        discard: () => releaseAdapter.pipe(Effect.asVoid),
      } satisfies PreparedOpenCodeLiveSessionAdapter;
    });
};
