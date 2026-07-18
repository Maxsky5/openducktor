import {
  type AgentSessionControlSummary,
  acceptedAgentUserMessageSchema,
  agentSessionContextUsageSchema,
  agentSessionControlSummarySchema,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import {
  type HostError,
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
import type {
  ClaudeAgentSdkEvent,
  ClaudeSessionContext,
  ClaudeSessionStore,
} from "../claude/claude-agent-sdk-types";
import { createClaudeLiveSessionEventCoordinator } from "./claude-live-session-event-coordinator";
import type { ClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";
import {
  requireClaudePolicy,
  toClaudeForkInput,
  toClaudeLoadContextInput,
  toClaudeReplyApprovalInput,
  toClaudeReplyQuestionInput,
  toClaudeResumeInput,
  toClaudeRuntimeUserMessageEvent,
  toClaudeSendInput,
  toClaudeStartInput,
} from "./claude-live-session-service-inputs";
import { createClaudeLiveSessionState } from "./claude-live-session-state";

export type { ClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";
export { createClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";

type ClaudeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

export type ClaudeLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedRuntimeLiveSessionAdapter, HostError>;

export type CreateClaudeLiveSessionAdapterPreparerInput = {
  readonly eventHub: ClaudeAgentSdkEventHub;
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation">;
  readonly service: ClaudeAgentSdkService;
  readonly sessionStore: ClaudeSessionStore;
};

const requireRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<ClaudeRuntimeInstance, HostValidationError> => {
  if (runtime.kind !== "claude" || runtime.runtimeRoute.type !== "host_service") {
    return Effect.fail(
      new HostValidationError({
        field: "runtime",
        message: `Claude live-session adapter requires a Claude host-service runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError({
        field: "runtime.runtimeRoute.identity",
        message: `Claude runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed({
    ...runtime,
    kind: "claude",
    runtimeRoute: {
      type: "host_service",
      identity: runtime.runtimeRoute.identity,
    },
  });
};

const parseOutput = <Output>(
  schema: { parse(value: unknown): Output },
  value: unknown,
  operation: string,
): Effect.Effect<Output, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const createClaudeLiveSessionAdapterPreparer =
  ({
    eventHub,
    liveSessionLifecycle,
    service,
    sessionStore,
  }: CreateClaudeLiveSessionAdapterPreparerInput): ClaudeLiveSessionAdapterPreparer =>
  (runtimeInput) =>
    Effect.gen(function* () {
      const runtime = yield* requireRuntime(runtimeInput);
      const state = createClaudeLiveSessionState({ runtime });

      const commit = <Value>(
        operation: string,
        mutation: () => AgentSessionLiveAdapterMutation<Value>,
      ): Effect.Effect<Value, HostError> =>
        liveSessionLifecycle.runAdapterMutation(
          Effect.try({
            try: mutation,
            catch: (cause) =>
              toHostOperationError(cause, operation, { runtimeId: runtime.runtimeId }),
          }),
        );

      const processEvent = (
        session: ClaudeSessionContext,
        event: ClaudeAgentSdkEvent,
      ): Effect.Effect<void, HostError> =>
        commit("claude-live-session.process-event", () => ({
          value: undefined,
          changes: state.applyEvent(session, event),
        })).pipe(
          Effect.catchAll((cause) => {
            const failure = toHostOperationError(cause, "claude-live-session.process-event", {
              runtimeId: runtime.runtimeId,
              eventType: event.type,
            });
            return commit("claude-live-session.publish-event-fault", () => ({
              value: undefined,
              changes: [
                {
                  type: "fault",
                  repoPath: runtime.repoPath,
                  operation: failure.operation,
                  message: failure.message,
                },
              ],
            })).pipe(Effect.zipRight(Effect.fail(failure)));
          }),
        );

      const eventCoordinator = createClaudeLiveSessionEventCoordinator({
        processEvent,
        runtimeId: runtime.runtimeId,
      });
      const unsubscribe = eventHub.subscribe(runtime.runtimeId, eventCoordinator.enqueueEvent);

      const sessionError = (operation: string, externalSessionId: string) => (cause: unknown) =>
        toHostOperationError(cause, operation, {
          runtimeId: runtime.runtimeId,
          externalSessionId,
        });

      const requireSessionContext = (externalSessionId: string) =>
        Effect.try({
          try: () => {
            const session = sessionStore.get(externalSessionId);
            if (!session) {
              throw new HostValidationError({
                field: "externalSessionId",
                message: `Unknown Claude session '${externalSessionId}'.`,
                details: { externalSessionId, runtimeId: runtime.runtimeId },
              });
            }
            return session;
          },
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : toHostOperationError(cause, "claude-live-session.require-session", {
                  runtimeId: runtime.runtimeId,
                  externalSessionId,
                }),
        });

      const runSummary = (
        operation: string,
        run: () => Effect.Effect<unknown, HostError>,
        options: {
          readonly forceRunning?: boolean;
          readonly parentExternalSessionId?: string;
        } = {},
      ): Effect.Effect<AgentSessionControlSummary, HostError> =>
        eventCoordinator.runControlMutation(
          run().pipe(
            Effect.flatMap((value) =>
              parseOutput(agentSessionControlSummarySchema, value, operation),
            ),
            Effect.flatMap((summary) =>
              commit(`${operation}.retain-summary`, () => ({
                value: options.forceRunning ? { ...summary, status: "running" as const } : summary,
                changes: state.retainControlSummary(summary, options),
              })),
            ),
          ),
        );

      const adapter: AgentSessionRuntimeAdapterPort = {
        binding: {
          runtimeId: runtime.runtimeId,
          runtimeKind: "claude",
          repoPath: runtime.repoPath,
        },
        matches: state.matches,
        listRetainedSnapshots: (repoPath) => Effect.succeed(state.listRetainedSnapshots(repoPath)),
        readRetainedSnapshot: (ref) => Effect.succeed(state.readRetainedSnapshot(ref)),
        loadContext: (input) =>
          requireClaudePolicy(input.runtimeKind, "load-context").pipe(
            Effect.flatMap((binding) =>
              service.loadSessionContextUsage(toClaudeLoadContextInput(input, binding)),
            ),
            Effect.flatMap((value) =>
              parseOutput(
                agentSessionContextUsageSchema.nullable(),
                value,
                "claude-live-session.normalize-context",
              ),
            ),
            Effect.flatMap((contextUsage) =>
              eventCoordinator
                .flush()
                .pipe(
                  Effect.flatMap(() =>
                    commit("claude-live-session.retain-context", () =>
                      state.applyLoadedContext(input, contextUsage),
                    ),
                  ),
                ),
            ),
          ),
        replyApproval: (input) =>
          requireClaudePolicy(input.runtimeKind, "reply-approval").pipe(
            Effect.flatMap((binding) =>
              eventCoordinator.runControlMutation(
                service
                  .replyApproval(toClaudeReplyApprovalInput(input, binding))
                  .pipe(
                    Effect.mapError(
                      sessionError("claude-live-session.reply-approval", input.externalSessionId),
                    ),
                  ),
              ),
            ),
          ),
        replyQuestion: (input) =>
          requireClaudePolicy(input.runtimeKind, "reply-question").pipe(
            Effect.flatMap((binding) =>
              eventCoordinator.runControlMutation(
                service
                  .replyQuestion(toClaudeReplyQuestionInput(input, binding))
                  .pipe(
                    Effect.mapError(
                      sessionError("claude-live-session.reply-question", input.externalSessionId),
                    ),
                  ),
              ),
            ),
          ),
        releaseRuntime: () =>
          Effect.suspend(() => {
            if (eventCoordinator.isReleased()) {
              return Effect.succeed([]);
            }
            return eventCoordinator
              .shutdown(
                Effect.gen(function* () {
                  const refs = state.release();
                  yield* service.stopSessionsForRuntime(runtime.runtimeId).pipe(
                    Effect.mapError((cause) =>
                      toHostOperationError(cause, "claude-live-session.release-runtime", {
                        runtimeId: runtime.runtimeId,
                      }),
                    ),
                  );
                  return refs;
                }),
              )
              .pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    unsubscribe();
                  }),
                ),
              );
          }),
        startSession: (input) =>
          requireClaudePolicy(input.runtimeKind, "start-session").pipe(
            Effect.flatMap((binding) =>
              runSummary(
                "claude-live-session.start-session",
                () => service.startSession(toClaudeStartInput(input, binding), runtime.runtimeId),
                { forceRunning: true },
              ),
            ),
          ),
        resumeSession: (input) =>
          requireClaudePolicy(input.runtimeKind, "resume-session").pipe(
            Effect.flatMap((binding) =>
              runSummary("claude-live-session.resume-session", () =>
                service.resumeSession(toClaudeResumeInput(input, binding), runtime.runtimeId),
              ),
            ),
          ),
        forkSession: (input) =>
          requireClaudePolicy(input.runtimeKind, "fork-session").pipe(
            Effect.flatMap((binding) =>
              runSummary(
                "claude-live-session.fork-session",
                () => service.forkSession(toClaudeForkInput(input, binding), runtime.runtimeId),
                {
                  forceRunning: true,
                  parentExternalSessionId: input.parentExternalSessionId,
                },
              ),
            ),
          ),
        sendUserMessage: (input) =>
          requireClaudePolicy(input.runtimeKind, "send-user-message").pipe(
            Effect.flatMap((binding) =>
              eventCoordinator.runControlMutation(
                service.sendUserMessage(toClaudeSendInput(input, binding), runtime.runtimeId).pipe(
                  Effect.mapError(
                    sessionError("claude-live-session.send-user-message", input.externalSessionId),
                  ),
                  Effect.flatMap((event) =>
                    parseOutput(
                      acceptedAgentUserMessageSchema,
                      event,
                      "claude-live-session.normalize-user-message",
                    ),
                  ),
                  Effect.flatMap((event) =>
                    requireSessionContext(input.externalSessionId).pipe(
                      Effect.flatMap((session) =>
                        commit("claude-live-session.publish-user-message", () => {
                          return {
                            value: event,
                            changes: state.applyEvent(
                              session,
                              toClaudeRuntimeUserMessageEvent(event),
                            ),
                          };
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        updateSessionModel: (input) =>
          service
            .updateSessionModel(input)
            .pipe(
              Effect.mapError(
                sessionError("claude-live-session.update-session-model", input.externalSessionId),
              ),
            ),
        stopSession: (input) =>
          eventCoordinator.runControlMutation(
            service.stopSession(input).pipe(
              Effect.mapError(
                sessionError("claude-live-session.stop-session", input.externalSessionId),
              ),
              Effect.flatMap(() =>
                commit("claude-live-session.remove-stopped-session", () => ({
                  value: undefined,
                  changes: state.removeSession(input),
                })),
              ),
            ),
          ),
        releaseSession: (input) =>
          eventCoordinator.runControlMutation(
            service.releaseSession(input).pipe(
              Effect.mapError(
                sessionError("claude-live-session.release-session", input.externalSessionId),
              ),
              Effect.flatMap(() =>
                commit("claude-live-session.remove-released-session", () => ({
                  value: undefined,
                  changes: state.removeSession(input),
                })),
              ),
            ),
          ),
      };

      return {
        adapter,
        startForwarding: eventCoordinator.startForwarding,
        discard: () => adapter.releaseRuntime().pipe(Effect.asVoid),
      } satisfies PreparedRuntimeLiveSessionAdapter;
    });
