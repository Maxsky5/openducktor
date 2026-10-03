import { agentSessionRefKey } from "@openducktor/core";
import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";

export type AgentSessionLiveEnvelopePublisher = (envelope: AgentSessionLiveEnvelope) => void;
export type AgentSessionLiveFaultLogger = (message: string) => Effect.Effect<void, HostError>;

export const createAgentSessionLiveEnvelopePublisher = (
  publish: AgentSessionLiveEnvelopePublisher,
  faultLog: AgentSessionLiveFaultLogger,
  persistence: AgentSessionPersistencePort | undefined,
) => {
  const publishEnvelopeResult = (
    envelope: AgentSessionLiveEnvelope,
  ): Effect.Effect<HostError | null, HostError> =>
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
      if (persistence) {
        const persisted = yield* Effect.either(persistence.observe(envelope));
        if (persisted._tag === "Left") {
          let ref: AgentSessionLiveRef | undefined;
          if (envelope.type === "transcript_event") ref = envelope.event.sessionRef;
          else if (envelope.type === "session_upsert") ref = envelope.session.ref;
          else if (envelope.type === "session_removed") ref = envelope.ref;
          if (ref) {
            yield* publishEnvelopeResult({
              type: "fault",
              repoPath: ref.repoPath,
              ref,
              operation: "agent-session.persist",
              message: persisted.left.message,
            });
          }
          return persisted.left;
        }
      }
      return null;
    });
  return publishEnvelopeResult;
};

type AgentSessionLiveFaultEnvelope = Extract<AgentSessionLiveEnvelope, { type: "fault" }>;
type AgentSessionLiveFaultRef = NonNullable<AgentSessionLiveFaultEnvelope["ref"]>;

type AgentSessionLiveFaultLogPayload = {
  repoPath: string;
  message: string;
  operation?: string;
  runtimeKind?: AgentSessionLiveFaultRef["runtimeKind"];
  workingDirectory?: AgentSessionLiveFaultRef["workingDirectory"];
  externalSessionId?: AgentSessionLiveFaultRef["externalSessionId"];
};

export const toAgentSessionLiveEnvelope = (
  change: AgentSessionLiveAdapterChange,
): AgentSessionLiveEnvelope => {
  switch (change.type) {
    case "session_upsert":
      return { type: "session_upsert", session: change.snapshot };
    case "session_removed":
      return { type: "session_removed", ref: change.ref };
    case "transcript_event":
      return { type: "transcript_event", event: change.event };
    case "catalog_invalidated":
      if (!change.workingDirectory) {
        return {
          type: "catalog_invalidated",
          scope: { repoPath: change.repoPath, runtimeKind: change.runtimeKind },
        };
      }
      return {
        type: "catalog_invalidated",
        scope: {
          repoPath: change.repoPath,
          runtimeKind: change.runtimeKind,
          workingDirectory: change.workingDirectory,
        },
      };
    case "slash_command_catalog_updated":
      return {
        type: "slash_command_catalog_updated",
        scope: {
          repoPath: change.repoPath,
          runtimeKind: change.runtimeKind,
          workingDirectory: change.workingDirectory,
        },
        catalog: change.catalog,
      };
    case "fault":
      const envelope: AgentSessionLiveFaultEnvelope = {
        type: "fault",
        repoPath: change.repoPath,
        message: change.message,
      };
      if (change.runtimeKind) envelope.runtimeKind = change.runtimeKind;
      if (change.operation) {
        envelope.operation = change.operation;
      }
      if (change.ref) {
        envelope.ref = change.ref;
      }
      return envelope;
  }
};

const formatAgentSessionLiveFaultLog = (envelope: AgentSessionLiveFaultEnvelope): string => {
  const payload: AgentSessionLiveFaultLogPayload = {
    repoPath: envelope.repoPath,
    message: envelope.message,
  };
  if (envelope.operation) {
    payload.operation = envelope.operation;
  }
  if (envelope.ref) {
    payload.runtimeKind = envelope.ref.runtimeKind;
    payload.workingDirectory = envelope.ref.workingDirectory;
    payload.externalSessionId = envelope.ref.externalSessionId;
  }
  return `agent-session-live.fault ${JSON.stringify(payload)}`;
};

const toAgentSessionLiveEnvelopePublishError = (
  cause: unknown,
  eventType: AgentSessionLiveEnvelope["type"],
): HostOperationErrorAggregate | HostValidationErrorAggregate =>
  cause instanceof HostOperationError || cause instanceof HostValidationError
    ? cause
    : new HostOperationError({
        operation: "agent-session-live.publish",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { eventType },
      });

export const createAgentSessionPublicationCursor = (
  hostEpoch: string,
  runtimeGenerations: (
    repoPath: string,
  ) => ReadonlyArray<{ runtimeKind: string; generation: string }>,
) => {
  let revision = 0;
  type Fault = {
    envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>;
    generation: string;
    revision: number;
  };
  const faults = new Map<string, Fault>();
  const generationFor = (repoPath: string, ref?: AgentSessionLiveRef, kind?: string) => {
    const runtimeKind = ref?.runtimeKind ?? kind;
    return JSON.stringify(
      runtimeGenerations(repoPath).filter(
        (generation) => !runtimeKind || generation.runtimeKind === runtimeKind,
      ),
    );
  };
  const sequences = new Map<string, number>();
  const read = (repoPath: string) => ({ hostEpoch, sequence: sequences.get(repoPath) ?? 0 });
  return {
    read,
    beginRecovery: () => revision,
    completeRecovery: (
      repoPath: string,
      startedAt: number,
      refs?: ReadonlyArray<AgentSessionLiveRef>,
    ) => {
      for (const [key, fault] of faults) {
        if (
          fault.envelope.repoPath === repoPath &&
          (!refs ||
            (fault.envelope.ref &&
              refs.some(
                (ref) => agentSessionRefKey(ref) === agentSessionRefKey(fault.envelope.ref!),
              ))) &&
          fault.revision <= startedAt &&
          fault.envelope.operation !== "agent-session.persist" &&
          !fault.envelope.operation?.includes("observe")
        )
          faults.delete(key);
      }
    },
    failures: (repoPath: string) =>
      Array.from(faults.values())
        .filter(
          (fault) =>
            fault.envelope.repoPath === repoPath &&
            (generationFor(repoPath, fault.envelope.ref, fault.envelope.runtimeKind) === "[]" ||
              fault.generation ===
                generationFor(repoPath, fault.envelope.ref, fault.envelope.runtimeKind)),
        )
        .map(({ envelope }) => {
          const { type: _type, repoPath: _repoPath, cursor: _cursor, ...failure } = envelope;
          return failure;
        }),
    stamp: (envelope: AgentSessionLiveEnvelope): AgentSessionLiveEnvelope => {
      const repoPath =
        "repoPath" in envelope
          ? envelope.repoPath
          : "scope" in envelope
            ? envelope.scope.repoPath
            : envelope.type === "session_upsert"
              ? envelope.session.ref.repoPath
              : envelope.type === "session_removed"
                ? envelope.ref.repoPath
                : envelope.event.sessionRef.repoPath;
      if (envelope.type === "fault") {
        revision += 1;
        faults.set(JSON.stringify([repoPath, envelope.ref, envelope.operation]), {
          envelope,
          generation: generationFor(repoPath, envelope.ref, envelope.runtimeKind),
          revision,
        });
      }
      sequences.set(repoPath, (sequences.get(repoPath) ?? 0) + 1);
      return { ...envelope, cursor: read(repoPath) };
    },
  };
};
