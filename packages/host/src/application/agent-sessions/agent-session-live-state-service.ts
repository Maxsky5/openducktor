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
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Cause, Effect, Exit } from "effect";
import type { z } from "zod";
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
import {
  formatAgentSessionLiveFaultLog,
  toAgentSessionLiveEnvelope,
  toAgentSessionLiveEnvelopePublishError,
} from "./agent-session-live-envelope";
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
  readonly publishSession: (input: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
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

const parseAdapterOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<{ operation: string }>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const createAgentSessionLiveStateService = ({
  adapterRegistry,
  faultLog,
  publish,
  coordinator = createLiveStateCoordinator(),
}: CreateAgentSessionLiveStateServiceInput): AgentSessionLiveStateService => {
  // Runtime reads can wait on the network, so they need a gate that does not block live events.
  const refreshGate = createLiveStateCoordinator();
  const publishEnvelopeResult = (envelope: AgentSessionLiveEnvelope) =>
    Effect.gen(function* () {
      if (envelope.type === "fault") {
        const faultLogResult = yield* Effect.either(
          faultLog(formatAgentSessionLiveFaultLog(envelope)),
        );
        const publishResult = yield* Effect.either(
          Effect.try({
            try: () => publish(envelope),
            catch: (cause) => toAgentSessionLiveEnvelopePublishError(cause, envelope.type),
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
                eventType: envelope.type,
                faultLogFailure: faultLogResult.left,
                publishFailure: publishResult.left,
              },
            }),
          );
        }
        if (faultLogResult._tag === "Left") {
          return faultLogResult.left;
        }
        if (publishResult._tag === "Left") {
          return yield* Effect.fail(publishResult.left);
        }
        return null;
      }
      yield* Effect.try({
        try: () => publish(envelope),
        catch: (cause) => toAgentSessionLiveEnvelopePublishError(cause, envelope.type),
      });
      return null;
    });

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
        const result = yield* publishEnvelopeResult(toAgentSessionLiveEnvelope(change));
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
      return flattened;
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
          return parsed;
        }),
      ),
    publishSession: (input) =>
      coordinator.run(
        Effect.gen(function* () {
          const adapter = yield* adapterRegistry.resolveForScope(input);
          const result = yield* adapter.readSnapshot(input);
          const parsed = yield* parseAdapterOutput(
            agentSessionLiveReadResultSchema,
            result,
            "agent-session-live.publish-session",
          );
          if (parsed.type === "missing") {
            return yield* Effect.fail(
              new HostInvariantError({
                invariant: "published_session_exists_in_live_state",
                message: `Live session '${input.externalSessionId}' is missing after its task record was stored.`,
                details: { ref: input },
              }),
            );
          }
          yield* publishEnvelope({ type: "session_upsert", session: parsed.session });
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
    replyApproval: (input) =>
      adapterRegistry
        .resolveForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.replyApproval(input))),
    replyQuestion: (input) =>
      adapterRegistry
        .resolveForScope(input)
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
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.updateSessionModel(input))),
    stopSession: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.stopSession(input))),
    releaseSession: (input) =>
      adapterRegistry
        .resolveControlForScope(input)
        .pipe(Effect.flatMap((adapter) => adapter.releaseSession(input))),
    registerRuntimeAdapter: (adapter) => {
      let registered = false;
      return Effect.gen(function* () {
        yield* coordinator.run(adapterRegistry.register(adapter));
        registered = true;
        yield* adapter.refreshSnapshots?.(adapter.binding.repoPath) ?? Effect.void;
        yield* coordinator.run(
          Effect.gen(function* () {
            const snapshots = yield* adapter.listSnapshots(adapter.binding.repoPath);
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
          }),
        );
      }).pipe(
        Effect.onError(() =>
          registered
            ? adapterRegistry.remove(adapter.binding.runtimeId).pipe(Effect.asVoid)
            : Effect.void,
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
          const snapshotExit = yield* Effect.exit(
            Effect.gen(function* () {
              const snapshots = yield* adapter.listSnapshots(adapter.binding.repoPath);
              const validated = yield* Effect.forEach(snapshots, (snapshot) =>
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
          if (Exit.isSuccess(snapshotExit)) {
            refs = snapshotExit.value;
          } else if (releasedRefsExit && Exit.isSuccess(releasedRefsExit)) {
            refs = releasedRefsExit.value;
          }
          yield* publishChanges(refs.map((ref) => ({ type: "session_removed" as const, ref })));
          const needsAuthoritativeSnapshot =
            Exit.isFailure(snapshotExit) && (!releasedRefsExit || Exit.isFailure(releasedRefsExit));
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
          if (Exit.isFailure(snapshotExit)) {
            failures.push(`live snapshots: ${Cause.pretty(snapshotExit.cause)}`);
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
