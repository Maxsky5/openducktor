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
  type AgentSessionLiveReadInput,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionLiveRefreshInput,
  type AgentSessionLiveReplyApprovalInput,
  type AgentSessionLiveReplyQuestionInput,
  type AgentSessionLiveSnapshot,
  agentSessionContextUsageSchema,
  agentSessionLiveEnvelopeSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import {
  type HostError,
  HostInvariantError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterMutation,
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import { createLiveStateCoordinator, type LiveStateCoordinator } from "./live-state-coordinator";

export type AgentSessionLiveEnvelopePublisher = (envelope: AgentSessionLiveEnvelope) => void;

export type AgentSessionLiveFaultLogger = (message: string) => Effect.Effect<void, HostError>;

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
  readonly runAdapterMutation: <Success>(
    mutation: Effect.Effect<AgentSessionLiveAdapterMutation<Success>, HostError>,
  ) => Effect.Effect<Success, HostError>;
};

export type CreateAgentSessionLiveStateServiceInput = {
  readonly adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  readonly faultLog: AgentSessionLiveFaultLogger;
  readonly publish: AgentSessionLiveEnvelopePublisher;
  readonly coordinator?: LiveStateCoordinator;
};

const sessionRefKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");

const parseAdapterOutput = <Output>(
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

const toEnvelope = (change: AgentSessionLiveAdapterChange): AgentSessionLiveEnvelope => {
  switch (change.type) {
    case "session_upsert":
      return { type: "session_upsert", session: change.snapshot };
    case "session_removed":
      return { type: "session_removed", ref: change.ref };
    case "transcript_event":
      return { type: "transcript_event", event: change.event };
    case "catalog_invalidated":
      return {
        type: "catalog_invalidated",
        scope: {
          repoPath: change.repoPath,
          runtimeKind: change.runtimeKind,
          ...(change.workingDirectory ? { workingDirectory: change.workingDirectory } : {}),
        },
      };
    case "fault":
      return {
        type: "fault",
        repoPath: change.repoPath,
        message: change.message,
        ...(change.operation ? { operation: change.operation } : {}),
        ...(change.ref ? { ref: change.ref } : {}),
      };
  }
};

const formatFaultLog = (envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>): string =>
  `agent-session-live.fault ${JSON.stringify({
    repoPath: envelope.repoPath,
    message: envelope.message,
    ...(envelope.operation ? { operation: envelope.operation } : {}),
    ...(envelope.ref
      ? {
          runtimeKind: envelope.ref.runtimeKind,
          workingDirectory: envelope.ref.workingDirectory,
          externalSessionId: envelope.ref.externalSessionId,
        }
      : {}),
  })}`;

const toEnvelopePublishError = (
  cause: unknown,
  eventType: AgentSessionLiveEnvelope["type"],
): HostOperationError | HostValidationError =>
  cause instanceof HostOperationError || cause instanceof HostValidationError
    ? cause
    : new HostOperationError({
        operation: "agent-session-live.publish",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { eventType },
      });

export const createAgentSessionLiveStateService = ({
  adapterRegistry,
  faultLog,
  publish,
  coordinator = createLiveStateCoordinator(),
}: CreateAgentSessionLiveStateServiceInput): AgentSessionLiveStateService => {
  const validateEnvelope = (envelope: AgentSessionLiveEnvelope) =>
    Effect.try({
      try: () => agentSessionLiveEnvelopeSchema.parse(envelope),
      catch: (cause) => toEnvelopePublishError(cause, envelope.type),
    });

  const publishEnvelope = (envelope: AgentSessionLiveEnvelope) =>
    Effect.gen(function* () {
      const validatedEnvelope = yield* validateEnvelope(envelope);
      if (validatedEnvelope.type === "fault") {
        const faultLogResult = yield* Effect.either(faultLog(formatFaultLog(validatedEnvelope)));
        const publishResult = yield* Effect.either(
          Effect.try({
            try: () => publish(validatedEnvelope),
            catch: (cause) => toEnvelopePublishError(cause, validatedEnvelope.type),
          }),
        );
        if (faultLogResult._tag === "Left" && publishResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "agent-session-live.publish-fault",
              message: `Fault logging failed: ${faultLogResult.left.message}\nFault envelope publication failed: ${publishResult.left.message}`,
              cause: {
                faultLogFailure: faultLogResult.left,
                publishFailure: publishResult.left,
              },
              details: {
                eventType: validatedEnvelope.type,
                faultLogFailure: faultLogResult.left,
                publishFailure: publishResult.left,
              },
            }),
          );
        }
        if (faultLogResult._tag === "Left") {
          return yield* Effect.fail(faultLogResult.left);
        }
        if (publishResult._tag === "Left") {
          return yield* Effect.fail(publishResult.left);
        }
        return;
      }
      yield* Effect.try({
        try: () => publish(validatedEnvelope),
        catch: (cause) => toEnvelopePublishError(cause, validatedEnvelope.type),
      });
    });

  const publishChanges = (changes: ReadonlyArray<AgentSessionLiveAdapterChange>) =>
    Effect.gen(function* () {
      for (const change of changes) {
        yield* publishEnvelope(toEnvelope(change));
      }
    });

  const listSnapshots = (repoPath: string) =>
    Effect.gen(function* () {
      const snapshots = yield* Effect.forEach(adapterRegistry.listForRepo(repoPath), (adapter) =>
        adapter.listRetainedSnapshots(repoPath),
      );
      const flattened = yield* Effect.forEach(snapshots.flat(), (snapshot) =>
        parseAdapterOutput(
          agentSessionLiveSnapshotSchema,
          snapshot,
          "agent-session-live.list-retained",
        ),
      );
      const seen = new Set<string>();
      for (const snapshot of flattened) {
        const key = sessionRefKey(snapshot.ref);
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
      return flattened;
    });

  const service: AgentSessionLiveStateService = {
    refresh: (input) =>
      coordinator.run(
        Effect.gen(function* () {
          const snapshots = yield* listSnapshots(input.repoPath);
          yield* publishEnvelope({
            type: "snapshot",
            repoPath: input.repoPath,
            sessions: [...snapshots],
          });
        }),
      ),
    list: (input) => coordinator.run(listSnapshots(input.repoPath)),
    read: (input) =>
      coordinator.run(
        Effect.gen(function* () {
          const adapter = yield* adapterRegistry.find(input);
          if (!adapter) {
            return { type: "missing", ref: input } satisfies AgentSessionLiveReadResult;
          }
          const result = yield* adapter.readRetainedSnapshot(input);
          return yield* parseAdapterOutput(
            agentSessionLiveReadResultSchema,
            result,
            "agent-session-live.read-retained",
          );
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
    replyApproval: (input) =>
      adapterRegistry
        .resolve(input)
        .pipe(Effect.flatMap((adapter) => adapter.replyApproval(input))),
    replyQuestion: (input) =>
      adapterRegistry
        .resolve(input)
        .pipe(Effect.flatMap((adapter) => adapter.replyQuestion(input))),
    startSession: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.startSession(input))),
    resumeSession: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.resumeSession(input))),
    forkSession: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.forkSession(input))),
    sendUserMessage: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.sendUserMessage(input))),
    updateSessionModel: (input) =>
      adapterRegistry
        .resolveControl(input)
        .pipe(Effect.flatMap((adapter) => adapter.updateSessionModel(input))),
    stopSession: (input) =>
      adapterRegistry
        .resolveControl(input)
        .pipe(Effect.flatMap((adapter) => adapter.stopSession(input))),
    releaseSession: (input) =>
      adapterRegistry
        .resolveControl(input)
        .pipe(Effect.flatMap((adapter) => adapter.releaseSession(input))),
    registerRuntimeAdapter: (adapter) => {
      let registered = false;
      return coordinator.run(
        Effect.gen(function* () {
          yield* adapterRegistry.register(adapter);
          registered = true;
          const snapshots = yield* adapter.listRetainedSnapshots(adapter.binding.repoPath);
          const validatedSnapshots = yield* Effect.forEach(snapshots, (snapshot) =>
            parseAdapterOutput(
              agentSessionLiveSnapshotSchema,
              snapshot,
              "agent-session-live.register-runtime",
            ),
          );
          yield* publishChanges(
            validatedSnapshots.map((snapshot) => ({
              type: "session_upsert" as const,
              snapshot,
            })),
          );
        }).pipe(
          Effect.onError(() =>
            registered
              ? adapterRegistry.remove(adapter.binding.runtimeId).pipe(Effect.asVoid)
              : Effect.void,
          ),
        ),
      );
    },
    releaseRuntime: (runtimeId) =>
      coordinator.run(
        Effect.gen(function* () {
          const adapter = yield* adapterRegistry.remove(runtimeId);
          if (!adapter) {
            return [];
          }
          const retainedExit = yield* Effect.exit(
            Effect.gen(function* () {
              const retained = yield* adapter.listRetainedSnapshots(adapter.binding.repoPath);
              const validated = yield* Effect.forEach(retained, (snapshot) =>
                parseAdapterOutput(
                  agentSessionLiveSnapshotSchema,
                  snapshot,
                  "agent-session-live.release-runtime",
                ),
              );
              return validated.map((snapshot) => snapshot.ref);
            }),
          );
          const releaseExit = yield* Effect.exit(adapter.releaseRuntime());
          const releasedRefsExit = Exit.isSuccess(releaseExit)
            ? yield* Effect.exit(
                Effect.forEach(releaseExit.value, (ref) =>
                  parseAdapterOutput(
                    agentSessionLiveRefSchema,
                    ref,
                    "agent-session-live.release-runtime-refs",
                  ),
                ),
              )
            : null;
          let refs: ReadonlyArray<AgentSessionLiveRef> = [];
          if (Exit.isSuccess(retainedExit)) {
            refs = retainedExit.value;
          } else if (releasedRefsExit && Exit.isSuccess(releasedRefsExit)) {
            refs = releasedRefsExit.value;
          }
          yield* publishChanges(refs.map((ref) => ({ type: "session_removed" as const, ref })));
          const needsAuthoritativeSnapshot =
            Exit.isFailure(retainedExit) && (!releasedRefsExit || Exit.isFailure(releasedRefsExit));
          const authoritativeSnapshotExit = needsAuthoritativeSnapshot
            ? yield* Effect.exit(
                Effect.gen(function* () {
                  const snapshots = yield* listSnapshots(adapter.binding.repoPath);
                  yield* publishEnvelope({
                    type: "snapshot",
                    repoPath: adapter.binding.repoPath,
                    sessions: [...snapshots],
                  });
                }),
              )
            : null;

          const failures: string[] = [];
          if (Exit.isFailure(retainedExit)) {
            failures.push(`retained snapshots: ${Cause.pretty(retainedExit.cause)}`);
          }
          if (Exit.isFailure(releaseExit)) {
            failures.push(`adapter cleanup: ${Cause.pretty(releaseExit.cause)}`);
          }
          if (releasedRefsExit && Exit.isFailure(releasedRefsExit)) {
            failures.push(`released refs: ${Cause.pretty(releasedRefsExit.cause)}`);
          }
          if (authoritativeSnapshotExit && Exit.isFailure(authoritativeSnapshotExit)) {
            failures.push(
              `authoritative snapshot: ${Cause.pretty(authoritativeSnapshotExit.cause)}`,
            );
          }
          if (failures.length > 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "agent-session-live.release-runtime",
                message: failures.join("\n"),
                details: { runtimeId },
              }),
            );
          }
          return refs;
        }),
      ),
    runAdapterMutation: (mutation) =>
      coordinator.run(
        Effect.gen(function* () {
          const result = yield* mutation;
          yield* publishChanges(result.changes);
          return result.value;
        }),
      ),
  };

  return service;
};
