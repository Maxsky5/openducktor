import {
  createClaudePendingApprovalResolver,
  preAdmissionNextActionOverrides,
} from "./claude-pending-approval-resolution";
import { createClaudeSessionImportAdapter } from "./claude-session-import";
import { withForkedSessionCleanup } from "./forked-session-cleanup";
import { createClaudeRuntimeQueryAdapter } from "./claude-runtime-query-adapter";
import {
  unsupportedGeneratedImageSource,
  unsupportedGeneratedImageOperations,
} from "./generated-image-unsupported";
import { agentSessionContextUsageSchema, type RuntimeKind } from "@openducktor/contracts";
import {
  AgentSessionResumeError,
  toAgentSessionResumeError,
} from "../../ports/agent-session-resume-error";
import { Effect } from "effect";
import type { ClaudePendingInputResolution } from "../../application/runtimes/claude-agent-sdk-service";
import {
  requireRuntimeWorkingDirectory,
  type RuntimeWorkingDirectoryInput,
} from "../../application/runtimes/runtime-working-directory";
import {
  type HostError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { createClaudeMessageControls } from "./claude-live-session-message-controls";
import { beginClaudeGoalRestore } from "../claude/claude-agent-sdk-goals";
import { parseClaudeTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";
import type { ClaudeLiveEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
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
  toClaudeSendInput,
  toClaudeStartInput,
} from "./claude-live-session-service-inputs";
import { createClaudeLiveSessionState } from "./claude-live-session-state";
import {
  createEventGuard,
  parseClaudeLiveSessionOutput,
  requireClaudeHostServiceRuntime,
  createClaudeRequiredSession,
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

      const acceptsEvent = createEventGuard(sessionStore);

      const processEvent = (
        session: ClaudeSessionContext,
        event: ClaudeLiveEvent,
      ): Effect.Effect<void, HostError> =>
        commit("claude-live-session.process-event", () => ({
          value: undefined,
          changes: acceptsEvent(session, event, "deliver") ? state.applyEvent(session, event) : [],
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
        acceptsEvent,
      });
      const unsubscribe = eventHub.subscribe(runtime.runtimeId, eventCoordinator.enqueueEvent);

      const sessionError =
        (operation: string, externalSessionId: string) =>
        (cause: unknown): HostOperationErrorAggregate =>
          toHostOperationError(cause, operation, {
            runtimeId: runtime.runtimeId,
            externalSessionId,
          });

      const requireSessionContext = createClaudeRequiredSession(sessionStore, runtime.runtimeId);

      const resolvePendingInput = (
        operation: string,
        externalSessionId: string,
        prepare: Effect.Effect<ClaudePendingInputResolution, HostError>,
        options?: import("../../ports/agent-session-live-adapter-port").ApprovalReplyOptions,
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
                        try: () => {
                          options?.onIssued?.();
                          complete();
                        },
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

      // A resume or continuation publishes the restored goal before its summary, so a re-attached
      // session never shows a snapshot without its goal. The transcript read runs outside the
      // serial lane: a retained session reads it before the resume, and a new session reads it
      // while Claude starts. A fork reads it after its summary.
      const restoreGoal = (repoPath: string) => (summary: { readonly externalSessionId: string }) =>
        messages.restoreGoal(repoPath, summary.externalSessionId);
      // `restoreGoal` reports a failed read.
      const readRetainedGoal = (externalSessionId: string) =>
        Effect.promise(async () => {
          const retained = sessionStore.get(externalSessionId);
          if (retained) await beginClaudeGoalRestore(retained).catch(() => {});
        });
      const { runSummary, runTitleUpdate, runClosure } = createClaudeControlRunner({
        runControlMutation: eventCoordinator.runControlMutation,
        runSessionClosure: eventCoordinator.runSessionClosure,
        removeSession: state.removeSession,
        commit,
        applyControlSummary: state.applyControlSummary,
        reportProjectionFailure: createClaudeProjectionFailureReporter({ commit }),
      });

      const requireSessionWorkingDirectory = (
        input: RuntimeWorkingDirectoryInput & { runtimeKind: RuntimeKind },
        operation: string,
      ) =>
        requireClaudePolicy(input.runtimeKind, operation).pipe(
          Effect.flatMap(() => requireRuntimeWorkingDirectory(workingDirectoryDependencies, input)),
        );

      const messages = createClaudeMessageControls({
        commit,
        runControlMutation: eventCoordinator.runControlMutation,
        requireSessionContext,
        send: (input, options) =>
          service
            .sendUserMessage(toClaudeSendInput(input), runtime.runtimeId, options)
            .pipe(
              Effect.mapError(
                sessionError("claude-live-session.send-user-message", input.externalSessionId),
              ),
            ),
        state,
      });

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
        replyApproval: (input, options) =>
          requireClaudePolicy(input.runtimeKind, "reply-approval").pipe(
            Effect.flatMap(() =>
              resolvePendingInput(
                "claude-live-session.reply-approval",
                input.externalSessionId,
                service.prepareApprovalReply(toClaudeReplyApprovalInput(input)),
                options,
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
                Effect.tap(() => service.dispose().pipe(Effect.andThen(Effect.sync(unsubscribe)))),
              );
          }),
        resolvePendingApproval: createClaudePendingApprovalResolver(service, state),
        startSession: (input) =>
          requireSessionWorkingDirectory(input, "start-session").pipe(
            Effect.flatMap(() =>
              runSummary(
                "claude-live-session.start-session",
                input.repoPath,
                () =>
                  service.startSession(
                    {
                      ...toClaudeStartInput(input),
                      workStartGuard: input.workStartGuard,
                      onWorkIssued: input.onWorkIssued,
                      onWorkAccepted: input.onWorkAccepted,
                    },
                    runtime.runtimeId,
                  ),
                { sessionScope: input.sessionScope },
              ),
            ),
          ),
        resumeSession: (input) =>
          requireSessionWorkingDirectory(input, "resume-session").pipe(
            Effect.andThen(readRetainedGoal(input.externalSessionId)),
            Effect.flatMap(() =>
              runSummary(
                "claude-live-session.resume-session",
                input.repoPath,
                () =>
                  service
                    .resumeSession(
                      {
                        ...toClaudeResumeInput(input),
                        workStartGuard: input.workStartGuard,
                        onWorkIssued: input.onWorkIssued,
                        onWorkAccepted: input.onWorkAccepted,
                      },
                      runtime.runtimeId,
                    )
                    .pipe(Effect.tap(restoreGoal(input.repoPath))),
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
                  service
                    .continueInterruptedTurn(
                      {
                        ...toClaudeContinueInput(input),
                        workStartGuard: input.workStartGuard,
                        onWorkIssued: input.onWorkIssued,
                        onWorkAccepted: input.onWorkAccepted,
                      },
                      runtime.runtimeId,
                      () => {
                        continuationAdmitted = true;
                      },
                    )
                    .pipe(Effect.tap(restoreGoal(input.repoPath))),
                ),
              ),
              Effect.mapError((cause) =>
                continuationAdmitted
                  ? new AgentSessionResumeError({
                      reason: "continuation_failed",
                      nativeOutcome: "accepted",
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
              withForkedSessionCleanup(input, adapter, (capture) =>
                runSummary(
                  "claude-live-session.fork-session",
                  input.repoPath,
                  () =>
                    service
                      .forkSession(
                        {
                          ...toClaudeForkInput(input),
                          workStartGuard: input.workStartGuard,
                          onWorkIssued: input.onWorkIssued,
                          onWorkAccepted: input.onWorkAccepted,
                        },
                        runtime.runtimeId,
                      )
                      .pipe(Effect.map(capture)),
                  { sessionScope: input.sessionScope },
                ).pipe(Effect.tap(restoreGoal(input.repoPath))),
              ),
            ),
          ),
        sendUserMessage: (input, options) =>
          requireSessionWorkingDirectory(input, "send-user-message").pipe(
            Effect.andThen(messages.sendUserMessage(input, options)),
          ),
        controlGoal: (input, options) =>
          requireSessionWorkingDirectory(input, "control-goal").pipe(
            Effect.andThen(messages.controlGoal(input, options)),
          ),
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
          runClosure(
            "claude-live-session.remove-stopped-session",
            input,
            service
              .stopSession(input)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.stop-session", input.externalSessionId),
                ),
              ),
          ),
        releaseSession: (input) =>
          runClosure(
            "claude-live-session.remove-released-session",
            input,
            service
              .releaseSession(input)
              .pipe(
                Effect.mapError(
                  sessionError("claude-live-session.release-session", input.externalSessionId),
                ),
              ),
          ),
      };

      return {
        adapter,
        startForwarding: eventCoordinator.startForwarding,
        discard: () => adapter.releaseRuntime().pipe(Effect.asVoid),
      } satisfies PreparedClaudeLiveSessionAdapter;
    });
