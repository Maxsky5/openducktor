import { baselineLiveSessionChanges } from "../../application/agent-sessions/baseline-live-session-changes";
import { createClaudeSessionImportAdapter } from "./claude-session-import";
import { createClaudeRuntimeQueryAdapter } from "./claude-runtime-query-adapter";
import {
  unsupportedGeneratedImageSource,
  unsupportedGeneratedImageOperations,
} from "./generated-image-unsupported";
import {
  type AcceptedAgentUserMessage,
  acceptedAgentUserMessageSchema,
  agentSessionContextUsageSchema,
  type RuntimeKind,
} from "@openducktor/contracts";
import {
  AgentSessionResumeError,
  type AgentSessionResumeNextActionOverrides,
  toAgentSessionResumeError,
} from "../../ports/agent-session-resume-error";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import { InterruptedTurnResumeError } from "@openducktor/core";
import { Effect } from "effect";
import type { ClaudePendingInputResolution } from "../../application/runtimes/claude-agent-sdk-service";
import { requireRuntimeWorkingDirectory } from "../../application/runtimes/runtime-working-directory";
import {
  type HostError,
  type HostOperationErrorAggregate,
  HostOperationError,
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
import {
  createClaudeControlRunner,
  createClaudeProjectionFailureReporter,
} from "./claude-live-session-control-runner";
import { createClaudeLiveSessionEventCoordinator } from "./claude-live-session-event-coordinator";
import {
  requireClaudePolicy,
  toClaudeContinueInput,
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
import {
  parseClaudeLiveSessionOutput,
  requireClaudeHostServiceRuntime,
  toClaudeLiveSessionRef,
} from "./claude-live-session-runtime-guards";

export type { ClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";
export { createClaudeAgentSdkEventHub } from "./claude-live-session-event-hub";
export type {
  ClaudeLiveSessionAdapterPreparer,
  ClaudeRuntimeSessionAdapterPreparer,
  CreateClaudeLiveSessionAdapterPreparerInput,
  PreparedClaudeLiveSessionAdapter,
} from "./claude-live-session-adapter-contract";

const preAdmissionNextActionOverrides = (cause: unknown): AgentSessionResumeNextActionOverrides =>
  cause instanceof HostOperationError && cause.cause instanceof InterruptedTurnResumeError
    ? { continuation_failed: "Send a new message to continue." }
    : {};

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
      const runtime = yield* requireClaudeHostServiceRuntime(runtimeInput);
      const state = createClaudeLiveSessionState();
      const binding = liveSessionLifecycle.createRuntimeRegistration({
        runtimeId: runtime.runtimeId,
        runtimeKind: runtime.kind,
      });

      const commit = <Value>(
        operation: string,
        mutation: () => AgentSessionLiveAdapterMutation<Value>,
      ): Effect.Effect<Value, HostError> =>
        binding.runMutation(
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
          Effect.catch((cause) => {
            const failure = toHostOperationError(cause, "claude-live-session.process-event", {
              runtimeId: runtime.runtimeId,
              eventType: event.type,
            });
            return commit("claude-live-session.publish-event-fault", () => ({
              value: undefined,
              changes: [
                {
                  type: "fault",
                  repoPath: session.input.repoPath,
                  operation: failure.operation,
                  message: failure.message,
                },
              ],
            })).pipe(Effect.andThen(Effect.fail(failure)));
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

      const { runSummary, runTitleUpdate } = createClaudeControlRunner({
        runControlMutation: eventCoordinator.runControlMutation,
        retainSummary: (operation, repoPath, summary, options) =>
          commit(`${operation}.retain-summary`, () => ({
            value: summary,
            changes:
              operation === "claude-live-session.import"
                ? baselineLiveSessionChanges(state.applyControlSummary(repoPath, summary, options))
                : state.applyControlSummary(repoPath, summary, options),
          })),
        reportProjectionFailure: createClaudeProjectionFailureReporter({ commit }),
      });

      const requireSessionWorkingDirectory = (
        input: { repoPath: string; runtimeKind: RuntimeKind; workingDirectory: string },
        operation: string,
      ) =>
        requireClaudePolicy(input.runtimeKind, operation).pipe(
          Effect.flatMap(() => requireRuntimeWorkingDirectory(workingDirectoryDependencies, input)),
        );

      const adapter: AgentSessionRuntimeAdapterPort = {
        claudeToolCatalog: { load: (input) => service.loadToolCatalog(input) },
        sessionImport: createClaudeSessionImportAdapter(
          service,
          runtime.runtimeId,
          (repoPath, attach) =>
            runSummary("claude-live-session.import", repoPath, attach, { keepActivity: true }),
        ),
        queries: createClaudeRuntimeQueryAdapter(service),
        ...unsupportedGeneratedImageOperations,
        resolveGeneratedImageSource: unsupportedGeneratedImageSource,
        supportsSessionControl: true,
        binding,
        listSnapshots: () => Effect.sync(() => state.listSnapshots()),
        readSnapshot: (ref) => Effect.succeed(state.readSnapshot(ref)),
        loadContext: (input) =>
          requireSessionWorkingDirectory(input, "load-context").pipe(
            Effect.andThen(eventCoordinator.flush()),
            Effect.andThen(Effect.sync(() => state.contextRevision(input))),
            Effect.flatMap((contextRevision) =>
              service
                .loadSessionContextUsage(toClaudeLoadContextInput(input))
                .pipe(Effect.map((value) => ({ contextRevision, value }))),
            ),
            Effect.flatMap(({ contextRevision, value }) =>
              parseClaudeLiveSessionOutput(
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
                    service.dispose();
                    unsubscribe();
                  }),
                ),
              );
          }),
        startSession: (input) =>
          requireSessionWorkingDirectory(input, "start-session").pipe(
            Effect.flatMap(() =>
              runSummary("claude-live-session.start-session", input.repoPath, () =>
                service.startSession(toClaudeStartInput(input), runtime.runtimeId),
              ),
            ),
          ),
        resumeSession: (input) =>
          requireSessionWorkingDirectory(input, "resume-session").pipe(
            Effect.flatMap(() =>
              runSummary(
                "claude-live-session.resume-session",
                input.repoPath,
                () => service.resumeSession(toClaudeResumeInput(input), runtime.runtimeId),
                { keepActivity: true },
              ),
            ),
          ),
        continueInterruptedTurn: (input) =>
          Effect.suspend(() => {
            const operation = "claude-live-session.continue-interrupted-turn";
            const sessionRef = toClaudeLiveSessionRef(input);
            let continuationAdmitted = false;
            return requireSessionWorkingDirectory(input, "continue-interrupted-turn").pipe(
              Effect.flatMap(() =>
                runSummary(operation, input.repoPath, () =>
                  service.continueInterruptedTurn(
                    toClaudeContinueInput(input),
                    runtime.runtimeId,
                    () => {
                      continuationAdmitted = true;
                    },
                  ),
                ),
              ),
              Effect.mapError((cause) =>
                continuationAdmitted
                  ? new AgentSessionResumeError({
                      reason: "continuation_failed",
                      sessionRef,
                      operation,
                      message: `${cause.message} The adapter already accepted the continuation, so the runtime can be working on it.`,
                      nextAction:
                        "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
                      cause,
                    })
                  : toAgentSessionResumeError(
                      cause,
                      sessionRef,
                      operation,
                      preAdmissionNextActionOverrides(cause),
                    ),
              ),
            );
          }),
        forkSession: (input) =>
          requireSessionWorkingDirectory(input, "fork-session").pipe(
            Effect.flatMap(() =>
              runSummary("claude-live-session.fork-session", input.repoPath, () =>
                service.forkSession(toClaudeForkInput(input), runtime.runtimeId),
              ),
            ),
          ),
        sendUserMessage: (input, options) =>
          Effect.suspend(() => {
            let acceptedMessage: AcceptedAgentUserMessage | null = null;
            return requireSessionWorkingDirectory(input, "send-user-message").pipe(
              Effect.flatMap(() =>
                eventCoordinator.runControlMutation(
                  Effect.gen(function* () {
                    const output = yield* service
                      .sendUserMessage(toClaudeSendInput(input), runtime.runtimeId, options)
                      .pipe(
                        Effect.mapError(
                          sessionError(
                            "claude-live-session.send-user-message",
                            input.externalSessionId,
                          ),
                        ),
                      );
                    const accepted = yield* parseClaudeLiveSessionOutput(
                      acceptedAgentUserMessageSchema,
                      output,
                      "claude-live-session.normalize-user-message",
                    );
                    acceptedMessage = accepted;
                    const session = yield* requireSessionContext(input.externalSessionId);
                    return yield* commit("claude-live-session.publish-user-message", () => {
                      state.reactivateSession(input);
                      return {
                        value: accepted,
                        changes: state.applyEvent(
                          session,
                          toClaudeRuntimeUserMessageEvent(accepted),
                        ),
                      };
                    });
                  }),
                ),
              ),
              Effect.mapError((cause) =>
                acceptedMessage ? messageAcceptedFailure(input, acceptedMessage)(cause) : cause,
              ),
            );
          }),
        updateSessionModel: (input) =>
          eventCoordinator.runControlMutation(
            service
              .updateSessionModel(input, runtime.runtimeId)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.update-session-model", input.externalSessionId),
                ),
              ),
          ),
        updateSessionTitle: (input) =>
          runTitleUpdate("claude-live-session.update-session-title", input.repoPath, () =>
            service.updateSessionTitle(input),
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
