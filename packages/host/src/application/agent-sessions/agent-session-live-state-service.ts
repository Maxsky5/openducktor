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
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveListInput,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionLiveLoadDiffInput,
  type AgentSessionLiveReadInput,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionLiveRefreshInput,
  type AgentSessionLiveReplyApprovalInput,
  type AgentSessionLiveReplyQuestionInput,
  type AgentSessionLiveSnapshot,
  type FileDiff,
  agentSessionContextUsageSchema,
  agentSessionLiveLoadDiffResultSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostInvariantError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterBinding,
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
  AgentSessionRuntimeAdapterPort,
  AgentSessionLiveAdapterScope,
} from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";
import {
  type AgentSessionLiveEnvelopePublisher,
  type AgentSessionLiveFaultLogger,
  createAgentSessionLiveEnvelopePublisher,
  toAgentSessionLiveEnvelope,
} from "./agent-session-live-envelope";
import { createLiveStateCoordinator, type LiveStateCoordinator } from "./live-state-coordinator";
import { createAgentSessionLiveRuntimeLifecycle } from "./agent-session-live-runtime-lifecycle";
import { parseAdapterOutput } from "./agent-session-live-validation";
import { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";

export type {
  AgentSessionLiveEnvelopePublisher,
  AgentSessionLiveFaultLogger,
} from "./agent-session-live-envelope";

export type AgentSessionLiveStateService = {
  readonly refresh: (input: AgentSessionLiveRefreshInput) => Effect.Effect<void, HostError>;
  readonly list: (
    input: AgentSessionLiveListInput,
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
  readonly forkSession: (
    input: AgentSessionControlForkInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly sendUserMessage: (
    input: AgentSessionControlSendInput,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  readonly updateSessionModel: (
    input: AgentSessionControlUpdateModelInput,
  ) => Effect.Effect<void, HostError>;
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
  readonly persistence?: AgentSessionPersistencePort;
  readonly adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  readonly withWorkStartLease: <A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | HostValidationErrorAggregate, R>;
  readonly faultLog: AgentSessionLiveFaultLogger;
  readonly publish: AgentSessionLiveEnvelopePublisher;
  readonly coordinator?: LiveStateCoordinator;
};

export const createAgentSessionLiveStateService = ({
  adapterRegistry,
  withWorkStartLease,
  faultLog,
  publish,
  coordinator = createLiveStateCoordinator(),
  persistence,
}: CreateAgentSessionLiveStateServiceInput): AgentSessionLiveStateService => {
  const withStartAdmission =
    <Input extends { repoPath: string }, Success>(
      operation: (input: Input) => Effect.Effect<Success, HostError>,
    ) =>
    (input: Input): Effect.Effect<Success, HostError> =>
      withWorkStartLease(input.repoPath, operation(input));
  // Runtime reads can wait on the network, so they need a gate that does not block live events.
  const refreshGate = createLiveStateCoordinator();
  const executionEpisodes = createAgentSessionExecutionEpisodes();
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
        const result = yield* publishEnvelopeResult(
          executionEpisodes.accept(toAgentSessionLiveEnvelope(change)),
        );
        if (faultLogFailure === null && result) {
          faultLogFailure = result;
        }
      }
      if (faultLogFailure) {
        return yield* Effect.fail(faultLogFailure);
      }
    });

  const listSnapshots = (repoPath: string) =>
    Effect.gen(function* () {
      const snapshots = yield* Effect.forEach(adapterRegistry.listForRepo(repoPath), (adapter) =>
        adapter.listSnapshots(repoPath),
      );
      const flattened = yield* Effect.forEach(snapshots.flat(), (snapshot) =>
        parseAdapterOutput(agentSessionLiveSnapshotSchema, snapshot, "agent-session-live.list"),
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

  const lifecycle = createAgentSessionLiveRuntimeLifecycle({
    adapterRegistry,
    coordinator,
    publishChanges,
    publishEnvelope,
    listSnapshots,
  });

  const runControl = <A>(
    scope: AgentSessionLiveAdapterScope,
    control: (adapter: AgentSessionRuntimeAdapterPort) => Effect.Effect<A, HostError>,
  ) =>
    Effect.gen(function* () {
      const adapter = yield* adapterRegistry.resolveControlForScope(scope);
      const result = yield* control(adapter);
      yield* lifecycle.requireAttached(adapter.binding);
      return result;
    });

  const service: AgentSessionLiveStateService = {
    refresh: (input) =>
      refreshGate.run(
        Effect.gen(function* () {
          yield* Effect.forEach(
            adapterRegistry.listForRepo(input.repoPath),
            (adapter) => adapter.refreshSnapshots?.(input.repoPath) ?? Effect.void,
          );
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
        .pipe(Effect.flatMap((adapter) => adapter.replyApproval(input))),
    ),
    replyQuestion: withStartAdmission((input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.replyQuestion(input))),
    ),
    startSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.startSession(input)),
    ),
    resumeSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.resumeSession(input)),
    ),
    forkSession: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.forkSession(input)),
    ),
    sendUserMessage: withStartAdmission((input) =>
      Effect.gen(function* () {
        const adapter = yield* adapterRegistry.resolveControlForScope(input);
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
    updateSessionModel: withStartAdmission((input) =>
      runControl(input, (adapter) => adapter.updateSessionModel(input)),
    ),
    stopSession: (input) => runControl(input, (adapter) => adapter.stopSession(input)),
    releaseSession: (input) => runControl(input, (adapter) => adapter.releaseSession(input)),
    registerRuntimeAdapter: lifecycle.registerRuntimeAdapter,
    releaseRuntime: lifecycle.releaseRuntime,
    createRuntimeRegistration: lifecycle.createRuntimeRegistration,
  };

  return service;
};
