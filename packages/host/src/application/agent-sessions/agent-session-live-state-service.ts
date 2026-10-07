import {
  type AcceptedAgentUserMessage,
  type AgentSessionContextUsage,
  type AgentSessionControlForkInput,
  type AgentSessionControlReleaseInput,
  type AgentSessionControlResumeInput,
  type AgentSessionControlSendInput,
  type AgentSessionControlStartInput,
  type AgentSessionControlStopInput,
  type AgentSessionControlSummary,
  type AgentSessionControlUpdateModelInput,
  type AgentSessionControlUpdateTitleInput,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveListInput,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionLiveLoadDiffInput,
  type AgentSessionLiveReadInput,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionAuthorizedRoot,
  type AgentSessionLiveRefreshInput,
  type AgentSessionLiveReplyApprovalInput,
  type AgentSessionLiveReplyQuestionInput,
  type AgentSessionLiveSnapshot,
  type FileDiff,
  agentSessionContextUsageSchema,
  agentSessionLiveLoadDiffResultSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveSnapshotSchema,
  type RuntimeKind,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { type HostError, HostInvariantError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterBinding,
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
  AgentSessionControlContinueInterruptedTurnInput,
  AgentSessionRuntimeAdapterPort,
  AgentSessionLiveAdapterScope,
  AgentSessionTitleUpdateOutcome,
} from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";
import {
  type AgentSessionLiveEnvelopePublisher,
  type AgentSessionLiveFaultLogger,
  createAgentSessionLiveEnvelopePublisher,
  toAgentSessionLiveEnvelope,
} from "./agent-session-live-envelope";
import { createRuntimeSessionEngagement } from "./agent-session-runtime-engagement";
import { createLiveStateCoordinator, type LiveStateCoordinator } from "./live-state-coordinator";
import { createAgentSessionLiveRuntimeLifecycle } from "./agent-session-live-runtime-lifecycle";
import { parseAdapterOutput } from "./agent-session-live-validation";
import { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";
import {
  continuationSessionRef,
  toContinuationResolutionError,
} from "./agent-session-continuation-errors";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";

export type {
  AgentSessionLiveEnvelopePublisher,
  AgentSessionLiveFaultLogger,
} from "./agent-session-live-envelope";

export type AgentSessionLiveStateService = {
  readonly refresh: (input: AgentSessionLiveRefreshInput) => Effect.Effect<void, HostError>;
  readonly list: (
    input: AgentSessionLiveListInput,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  /**
   * Lists the sessions that a lifecycle action of one runtime kind stops or detaches, across all
   * repositories. Idle sessions that the runtime only restored from saved history stay out.
   */
  readonly listRuntimeSessions: (
    runtimeKind: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly read: (
    input: AgentSessionLiveReadInput,
  ) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  readonly loadContext: (
    input: AgentSessionLiveLoadContextInput,
  ) => Effect.Effect<AgentSessionContextUsage | null, HostError>;
  readonly loadSessionDiff: (
    input: AgentSessionLiveLoadDiffInput,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, HostError>;
  readonly replyApproval: (
    input: AgentSessionLiveReplyApprovalInput,
  ) => Effect.Effect<void, HostError>;
  readonly replyQuestion: (
    input: AgentSessionLiveReplyQuestionInput,
  ) => Effect.Effect<void, HostError>;
  readonly startSession: (
    input: AgentSessionControlStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly resumeSession: (
    input: AgentSessionControlResumeInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly continueInterruptedTurn: (
    input: AgentSessionControlContinueInterruptedTurnInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly forkSession: (
    input: AgentSessionControlForkInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly sendUserMessage: (
    input: AgentSessionControlSendInput,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  readonly updateSessionModel: (
    input: AgentSessionControlUpdateModelInput,
  ) => Effect.Effect<void, HostError>;
  readonly updateSessionTitle: (
    input: AgentSessionControlUpdateTitleInput,
  ) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>;
  readonly stopSession: (input: AgentSessionControlStopInput) => Effect.Effect<void, HostError>;
  readonly releaseSession: (
    input: AgentSessionControlReleaseInput,
  ) => Effect.Effect<void, HostError>;
  readonly registerRuntimeAdapter: (
    adapter: AgentSessionLiveAdapterPort,
  ) => Effect.Effect<void, HostError>;
  readonly releaseRuntime: (
    runtimeId: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;
  readonly createRuntimeRegistration: (
    binding: AgentSessionLiveAdapterBinding,
  ) => AgentSessionLiveRegistration;
};

export type CreateAgentSessionLiveStateServiceInput = {
  readonly readSessionRootRefs?: (
    repoPath: string,
  ) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
  readonly persistence?: AgentSessionPersistencePort;
  readonly adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  readonly runtimeAdmission: RuntimeAdmissionPort;
  readonly withProcessStartAdmission?: WithProcessStartAdmission | undefined;
  readonly faultLog: AgentSessionLiveFaultLogger;
  readonly publish: AgentSessionLiveEnvelopePublisher;
  readonly observeNotificationInput?: (
    envelope: AgentSessionLiveEnvelope,
    provenance: "baseline" | "live",
  ) => void;
  readonly coordinator?: LiveStateCoordinator;
};

export const createAgentSessionLiveStateService = ({
  adapterRegistry,
  runtimeAdmission,
  readSessionRootRefs,
  withProcessStartAdmission,
  faultLog,
  publish,
  observeNotificationInput,
  coordinator = createLiveStateCoordinator(),
  persistence,
}: CreateAgentSessionLiveStateServiceInput): AgentSessionLiveStateService => {
  // Controls enter the shared runtime only while its current generation is ready.
  const withStartAdmission =
    <Input extends { repoPath: string; runtimeKind: RuntimeKind }, Success>(
      operation: (input: Input) => Effect.Effect<Success, HostError>,
    ) =>
    (input: Input): Effect.Effect<Success, HostError> => {
      const admitted = runtimeAdmission.admit(input.runtimeKind, operation(input));
      return withProcessStartAdmission
        ? withProcessStartAdmission(input.repoPath, admitted)
        : admitted;
    };
  const observedRepoPaths = new Set<string>();
  // Runtime reads can wait on the network, so they need a gate that does not block live events.
  const refreshGate = createLiveStateCoordinator();
  // Transient admission guard that spans the probe and the native continuation for one session.
  const continuationsInFlight = new Set<string>();
  const executionEpisodes = createAgentSessionExecutionEpisodes();
  const engagement = createRuntimeSessionEngagement();
  const publishEnvelopeResult = createAgentSessionLiveEnvelopePublisher(
    publish,
    faultLog,
    persistence,
  );

  const publishEnvelope = (envelope: AgentSessionLiveEnvelope) =>
    publishEnvelopeResult(envelope).pipe(
      Effect.flatMap((faultLogFailure) =>
        faultLogFailure ? Effect.fail(faultLogFailure) : Effect.void,
      ),
    );

  const publishChanges = (changes: ReadonlyArray<AgentSessionLiveAdapterChange>) =>
    Effect.gen(function* () {
      let faultLogFailure: HostError | null = null;
      for (const change of changes) {
        const envelope = executionEpisodes.accept(toAgentSessionLiveEnvelope(change));
        observeNotificationInput?.(envelope, change.provenance ?? "live");
        const result = yield* publishEnvelopeResult(envelope);
        if (faultLogFailure === null && result) {
          faultLogFailure = result;
        }
      }
      if (faultLogFailure) {
        return yield* Effect.fail(faultLogFailure);
      }
    });

  const readAdapterSnapshots = (
    adapters: ReadonlyArray<AgentSessionLiveAdapterPort>,
    include: (snapshot: AgentSessionLiveSnapshot) => boolean,
  ) =>
    Effect.gen(function* () {
      const snapshots = yield* Effect.forEach(adapters, (adapter) => adapter.listSnapshots());
      return yield* Effect.forEach(snapshots.flat().filter(include), (snapshot) =>
        parseAdapterOutput(agentSessionLiveSnapshotSchema, snapshot, "agent-session-live.list"),
      );
    });

  const listSnapshots = (repoPath: string) =>
    Effect.gen(function* () {
      const flattened = yield* readAdapterSnapshots(
        adapterRegistry.list(),
        (snapshot) => snapshot.ref.repoPath === repoPath,
      );
      const seen = new Set<string>();
      for (const snapshot of flattened) {
        const key = agentSessionRefKey(snapshot.ref);
        if (seen.has(key)) {
          return yield* Effect.fail(
            new HostInvariantError({
              invariant: "agent_session_live_snapshot_has_one_owner",
              message: `Multiple live runtimes projected session '${snapshot.ref.externalSessionId}' in '${snapshot.ref.workingDirectory}'.`,
              details: { ref: snapshot.ref },
            }),
          );
        }
        seen.add(key);
      }
      return executionEpisodes.replaceSnapshots(repoPath, flattened);
    });

  const refreshAdapters = (
    repoPath: string,
    adapters: ReadonlyArray<AgentSessionLiveAdapterPort>,
  ): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const roots = readSessionRootRefs ? yield* readSessionRootRefs(repoPath) : [];
      yield* Effect.forEach(
        adapters,
        (adapter) =>
          adapter.refreshSnapshots?.(
            repoPath,
            roots.filter((root) => root.runtimeKind === adapter.binding.runtimeKind),
          ) ?? Effect.void,
      );
    });

  const lifecycle = createAgentSessionLiveRuntimeLifecycle({
    adapterRegistry,
    coordinator,
    publishChanges,
    publishEnvelope,
    listSnapshots,
    // A new shared runtime restores the exact roots of every repository a renderer observes.
    // A failed repository gets its own fault, so it cannot stop the runtime for the others.
    refreshSnapshots: (adapter) =>
      adapter.refreshSnapshots
        ? refreshGate.run(
            Effect.forEach([...observedRepoPaths], (repoPath) =>
              refreshAdapters(repoPath, [adapter]).pipe(
                Effect.catch((cause) =>
                  publishEnvelope({
                    type: "fault",
                    repoPath,
                    operation: "agent-session-live.restore-runtime-sessions",
                    message: `Cannot restore the ${adapter.binding.runtimeKind} sessions of this repository: ${cause.message}`,
                  }),
                ),
              ),
            ),
          )
        : Effect.void,
    observedRepoPaths: () => [...observedRepoPaths],
  });

  const runControl = <A>(
    scope: AgentSessionLiveAdapterScope,
    control: (adapter: AgentSessionRuntimeAdapterPort) => Effect.Effect<A, HostError>,
    isCommitted: (result: A) => boolean = () => false,
  ) =>
    Effect.gen(function* () {
      const adapter = engagement.trackControls(
        yield* adapterRegistry.resolveControlForScope(scope),
      );
      const result = yield* control(adapter);
      // A committed native change stays valid when the runtime detaches right after it.
      if (isCommitted(result)) return result;
      yield* lifecycle.requireAttached(adapter.binding);
      return result;
    });

  // A lifecycle action drains admitted controls. It stops and releases the sessions itself.
  const runAdmittedControl: typeof runControl = (scope, control, isCommitted) =>
    runtimeAdmission.admit(scope.runtimeKind, runControl(scope, control, isCommitted));

  const service: AgentSessionLiveStateService = {
    refresh: (input) =>
      refreshGate.run(
        Effect.gen(function* () {
          observedRepoPaths.add(input.repoPath);
          yield* refreshAdapters(input.repoPath, adapterRegistry.list());
          yield* coordinator.run(
            Effect.gen(function* () {
              const snapshots = yield* listSnapshots(input.repoPath);
              yield* publishEnvelope({
                type: "snapshot",
                repoPath: input.repoPath,
                sessions: [...snapshots],
              });
            }),
          );
        }),
      ),
    list: (input) => coordinator.run(listSnapshots(input.repoPath)),
    listRuntimeSessions: (runtimeKind) =>
      coordinator.run(
        Effect.forEach(
          adapterRegistry.list().filter((adapter) => adapter.binding.runtimeKind === runtimeKind),
          (adapter) =>
            readAdapterSnapshots([adapter], () => true).pipe(
              Effect.map((snapshots) => engagement.affected(adapter.binding, snapshots)),
            ),
        ).pipe(
          Effect.map((snapshots) =>
            snapshots.flat().map((snapshot) => executionEpisodes.snapshotWithEpisode(snapshot)),
          ),
        ),
      ),
    read: (input) =>
      coordinator.run(
        Effect.gen(function* () {
          const adapter = yield* adapterRegistry.resolveForScope(input).pipe(
            Effect.map((value): AgentSessionLiveAdapterPort | null => value),
            Effect.catchTag("HostResourceError", () => Effect.succeed(null)),
          );
          if (!adapter) {
            return { type: "missing", ref: input } satisfies AgentSessionLiveReadResult;
          }
          const result = yield* adapter.readSnapshot(input);
          const parsed = yield* parseAdapterOutput(
            agentSessionLiveReadResultSchema,
            result,
            "agent-session-live.read",
          );
          if (parsed.type === "missing") {
            return parsed;
          }
          return { ...parsed, session: executionEpisodes.snapshotWithEpisode(parsed.session) };
        }),
      ),
    loadContext: (input) =>
      adapterRegistry.resolveForScope(input).pipe(
        Effect.flatMap((adapter) => adapter.loadContext(input)),
        Effect.flatMap((result) =>
          parseAdapterOutput(
            agentSessionContextUsageSchema.nullable(),
            result,
            "agent-session-live.load-context",
          ),
        ),
      ),
    loadSessionDiff: (input) =>
      adapterRegistry.resolveForScope(input).pipe(
        Effect.flatMap((adapter) => {
          if (!adapter.loadSessionDiff) {
            return Effect.fail(
              new HostValidationError({
                field: "runtimeKind",
                message: `Runtime '${input.runtimeKind}' does not expose live session diff state.`,
                details: { runtimeKind: input.runtimeKind },
              }),
            );
          }
          return adapter.loadSessionDiff(input);
        }),
        Effect.flatMap((result) =>
          parseAdapterOutput(
            agentSessionLiveLoadDiffResultSchema,
            result,
            "agent-session-live.load-diff",
          ),
        ),
      ),
    replyApproval: withStartAdmission((input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => engagement.trackReplies(adapter).replyApproval(input))),
    ),
    replyQuestion: withStartAdmission((input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => engagement.trackReplies(adapter).replyQuestion(input))),
    ),
    startSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.startSession(input)),
    ),
    resumeSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.resumeSession(input)),
    ),
    continueInterruptedTurn: withStartAdmission((input) =>
      Effect.gen(function* () {
        const adapter = yield* adapterRegistry.resolveControlForScope(input).pipe(
          Effect.map(engagement.trackControls),
          Effect.mapError((cause) => toContinuationResolutionError(cause, input)),
        );
        const continuationKey = [
          adapter.binding.runtimeId,
          input.externalSessionId,
          input.workingDirectory,
        ].join("\u0000");
        if (continuationsInFlight.has(continuationKey)) {
          return yield* Effect.fail(
            new AgentSessionResumeError({
              reason: "continuation_in_progress",
              sessionRef: continuationSessionRef(input),
              operation: "agent-session.continue-interrupted-turn",
              message: `Session '${input.externalSessionId}' already has a continuation in progress. Wait for it to settle, then retry Resume.`,
            }),
          );
        }
        continuationsInFlight.add(continuationKey);
        const summary = yield* adapter
          .continueInterruptedTurn(input)
          .pipe(Effect.ensuring(Effect.sync(() => continuationsInFlight.delete(continuationKey))));
        yield* lifecycle.requireAttached(adapter.binding).pipe(
          Effect.mapError(
            (cause) =>
              new AgentSessionResumeError({
                reason: "runtime_unavailable",
                sessionRef: continuationSessionRef(input),
                operation: "agent-session.continue-interrupted-turn",
                message: `${cause.message} The adapter already accepted the continuation, so the runtime can be working on it.`,
                nextAction:
                  "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
                cause,
              }),
          ),
        );
        return summary;
      }),
    ),
    forkSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.forkSession(input)),
    ),
    sendUserMessage: withStartAdmission((input) =>
      Effect.gen(function* () {
        const adapter = engagement.trackControls(
          yield* adapterRegistry.resolveControlForScope(input),
        );
        const acceptedMessage = yield* adapter.sendUserMessage(input);
        yield* lifecycle.requireAttached(adapter.binding).pipe(
          Effect.mapError(
            (cause) =>
              new AgentSessionMessageAcceptedError(
                {
                  sessionRef: {
                    repoPath: input.repoPath,
                    runtimeKind: input.runtimeKind,
                    workingDirectory: input.workingDirectory,
                    externalSessionId: input.externalSessionId,
                  },
                  acceptedMessage,
                  stage: "live_update",
                },
                cause,
              ),
          ),
        );
        return acceptedMessage;
      }),
    ),
    updateSessionModel: (input) =>
      runAdmittedControl(input, (adapter) => adapter.updateSessionModel(input)),
    updateSessionTitle: (input) =>
      runAdmittedControl(
        input,
        (adapter) => adapter.updateSessionTitle(input),
        (outcome) => outcome.status === "renamed",
      ),
    stopSession: (input) => runControl(input, (adapter) => adapter.stopSession(input)),
    releaseSession: (input) => runControl(input, (adapter) => adapter.releaseSession(input)),
    registerRuntimeAdapter: lifecycle.registerRuntimeAdapter,
    releaseRuntime: lifecycle.releaseRuntime,
    createRuntimeRegistration: lifecycle.createRuntimeRegistration,
  };

  return service;
};
