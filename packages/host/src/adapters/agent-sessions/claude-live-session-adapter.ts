import {
  type AgentSessionControlSummary,
  acceptedAgentUserMessageSchema,
  agentSessionContextUsageSchema,
  agentSessionControlSummarySchema,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import type { ClaudePendingInputResolution } from "../../application/runtimes/claude-agent-sdk-service";
import { requireClaudeWorkspaceWorkingDirectory } from "../../application/runtimes/claude-workspace-runtime";
import {
  type HostError,
  type HostOperationErrorAggregate,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { parseClaudeTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import type {
  ClaudeRuntimeSessionAdapterPreparer,
  CreateClaudeLiveSessionAdapterPreparerInput,
  PreparedClaudeLiveSessionAdapter,
} from "./claude-live-session-adapter-contract";
import { createClaudeLiveSessionEventCoordinator } from "./claude-live-session-event-coordinator";
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
export type {
  ClaudeLiveSessionAdapterPreparer,
  ClaudeRuntimeSessionAdapterPreparer,
  CreateClaudeLiveSessionAdapterPreparerInput,
  PreparedClaudeLiveSessionAdapter,
} from "./claude-live-session-adapter-contract";

type ClaudeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

type ClaudeRuntimeValidationDetails =
  | { readonly runtimeId: string; readonly runtimeKind: RuntimeKind }
  | { readonly runtimeId: string };

type OperationValidationDetails = { readonly operation: string };

const requireRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<ClaudeRuntimeInstance, HostValidationError<ClaudeRuntimeValidationDetails>> => {
  if (runtime.kind !== "claude" || runtime.runtimeRoute.type !== "host_service") {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
        field: "runtime",
        message: `Claude live-session adapter requires a Claude host-service runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
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

const parseOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<OperationValidationDetails>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError<OperationValidationDetails>({
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
    workingDirectoryDependencies,
  }: CreateClaudeLiveSessionAdapterPreparerInput): ClaudeRuntimeSessionAdapterPreparer =>
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

      const sessionError =
        (operation: string, externalSessionId: string) =>
        (cause: unknown): HostOperationErrorAggregate =>
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

      const resolvePendingInput = (
        operation: string,
        externalSessionId: string,
        prepare: Effect.Effect<ClaudePendingInputResolution, HostError>,
      ): Effect.Effect<void, HostError> =>
        eventCoordinator.runControlMutation(
          prepare.pipe(
            Effect.mapError(sessionError(operation, externalSessionId)),
            Effect.flatMap((resolution) => {
              const rootExternalSessionId = parseClaudeTranscriptTarget(
                resolution.event.externalSessionId,
              ).sessionId;
              return requireSessionContext(rootExternalSessionId).pipe(
                Effect.flatMap((session) => {
                  let rollback = () => {};
                  return commit(`${operation}.publish`, () => {
                    const applied = state.applyPendingResolution(session, resolution.event);
                    rollback = applied.rollback;
                    return {
                      value: resolution.complete,
                      changes: applied.changes,
                    };
                  }).pipe(
                    Effect.tapError(() => Effect.sync(rollback)),
                    Effect.flatMap((complete) =>
                      Effect.try({
                        try: complete,
                        catch: (cause) =>
                          toHostOperationError(cause, `${operation}.complete`, {
                            runtimeId: runtime.runtimeId,
                            externalSessionId,
                          }),
                      }),
                    ),
                  );
                }),
              );
            }),
          ),
        );

      const runSummary = (
        operation: string,
        run: () => Effect.Effect<unknown, HostError>,
        options: {
          readonly parentExternalSessionId?: string;
          readonly preserveRetainedActivity?: boolean;
        } = {},
      ): Effect.Effect<AgentSessionControlSummary, HostError> =>
        eventCoordinator.runControlMutation(
          run().pipe(
            Effect.flatMap((value) =>
              parseOutput(agentSessionControlSummarySchema, value, operation),
            ),
            Effect.flatMap((summary) =>
              commit(`${operation}.retain-summary`, () => ({
                value: summary,
                changes: state.retainControlSummary(summary, options),
              })),
            ),
          ),
        );

      const requireSessionWorkingDirectory = (
        input: { repoPath: string; runtimeKind: RuntimeKind; workingDirectory: string },
        operation: string,
      ) =>
        requireClaudePolicy(input.runtimeKind, operation).pipe(
          Effect.flatMap(() =>
            requireClaudeWorkspaceWorkingDirectory(workingDirectoryDependencies, input),
          ),
        );

      const adapter: AgentSessionRuntimeAdapterPort = {
        supportsSessionControl: true,
        binding: {
          runtimeId: runtime.runtimeId,
          runtimeKind: "claude",
          repoPath: runtime.repoPath,
        },
        matches: state.matches,
        listRetainedSnapshots: (repoPath) => Effect.succeed(state.listRetainedSnapshots(repoPath)),
        readRetainedSnapshot: (ref) => Effect.succeed(state.readRetainedSnapshot(ref)),
        loadContext: (input) =>
          requireSessionWorkingDirectory(input, "load-context").pipe(
            Effect.zipRight(eventCoordinator.flush()),
            Effect.zipRight(Effect.sync(() => state.contextRevision(input))),
            Effect.flatMap((contextRevision) =>
              service
                .loadSessionContextUsage(toClaudeLoadContextInput(input))
                .pipe(Effect.map((value) => ({ contextRevision, value }))),
            ),
            Effect.flatMap(({ contextRevision, value }) =>
              parseOutput(
                agentSessionContextUsageSchema.nullable(),
                value,
                "claude-live-session.normalize-context",
              ).pipe(Effect.map((contextUsage) => ({ contextRevision, contextUsage }))),
            ),
            Effect.flatMap(({ contextRevision, contextUsage }) =>
              eventCoordinator
                .flush()
                .pipe(
                  Effect.flatMap(() =>
                    commit("claude-live-session.retain-context", () =>
                      state.applyLoadedContext(input, contextUsage, contextRevision),
                    ),
                  ),
                ),
            ),
          ),
        replyApproval: (input) =>
          requireClaudePolicy(input.runtimeKind, "reply-approval").pipe(
            Effect.flatMap(() =>
              resolvePendingInput(
                "claude-live-session.reply-approval",
                input.externalSessionId,
                service.prepareApprovalReply(toClaudeReplyApprovalInput(input)),
              ),
            ),
          ),
        replyQuestion: (input) =>
          requireClaudePolicy(input.runtimeKind, "reply-question").pipe(
            Effect.flatMap(() =>
              resolvePendingInput(
                "claude-live-session.reply-question",
                input.externalSessionId,
                service.prepareQuestionReply(toClaudeReplyQuestionInput(input)),
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
                  yield* service.stopSessionsForRuntime(runtime.runtimeId).pipe(
                    Effect.mapError((cause) =>
                      toHostOperationError(cause, "claude-live-session.release-runtime", {
                        runtimeId: runtime.runtimeId,
                      }),
                    ),
                  );
                  return state.release();
                }),
              )
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    unsubscribe();
                  }),
                ),
              );
          }),
        startSession: (input) =>
          requireSessionWorkingDirectory(input, "start-session").pipe(
            Effect.flatMap(() =>
              runSummary("claude-live-session.start-session", () =>
                service.startSession(toClaudeStartInput(input), runtime.runtimeId),
              ),
            ),
          ),
        resumeSession: (input) =>
          requireSessionWorkingDirectory(input, "resume-session").pipe(
            Effect.flatMap(() =>
              runSummary(
                "claude-live-session.resume-session",
                () => service.resumeSession(toClaudeResumeInput(input), runtime.runtimeId),
                { preserveRetainedActivity: true },
              ),
            ),
          ),
        forkSession: (input) =>
          requireSessionWorkingDirectory(input, "fork-session").pipe(
            Effect.flatMap(() =>
              runSummary("claude-live-session.fork-session", () =>
                service.forkSession(toClaudeForkInput(input), runtime.runtimeId),
              ),
            ),
          ),
        sendUserMessage: (input) =>
          requireSessionWorkingDirectory(input, "send-user-message").pipe(
            Effect.flatMap(() =>
              eventCoordinator.runControlMutation(
                service.sendUserMessage(toClaudeSendInput(input), runtime.runtimeId).pipe(
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
                          state.reactivateSession(input);
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
          eventCoordinator.runControlMutation(
            service
              .updateSessionModel(input)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.update-session-model", input.externalSessionId),
                ),
              ),
          ),
        stopSession: (input) =>
          eventCoordinator.runSessionClosure(
            input.externalSessionId,
            service
              .stopSession(input)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.stop-session", input.externalSessionId),
                ),
              ),
            () =>
              commit("claude-live-session.remove-stopped-session", () => ({
                value: undefined,
                changes: state.removeSession(input),
              })),
          ),
        releaseSession: (input) =>
          eventCoordinator.runSessionClosure(
            input.externalSessionId,
            service
              .releaseSession(input)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.release-session", input.externalSessionId),
                ),
              ),
            () =>
              commit("claude-live-session.remove-released-session", () => ({
                value: undefined,
                changes: state.removeSession(input),
              })),
          ),
      };

      return {
        adapter,
        startForwarding: eventCoordinator.startForwarding,
        discard: () => adapter.releaseRuntime().pipe(Effect.asVoid),
      } satisfies PreparedClaudeLiveSessionAdapter;
    });
