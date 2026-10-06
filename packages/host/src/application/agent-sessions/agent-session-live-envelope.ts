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
        const faultLogResult = yield* Effect.result(
          faultLog(formatAgentSessionLiveFaultLog(envelope)),
        );
        const publishResult = yield* Effect.result(
          Effect.try({
            try: () => publish(envelope),
            catch: (cause) => toAgentSessionLiveEnvelopePublishError(cause, envelope.type),
          }),
        );
        if (faultLogResult._tag === "Failure" && publishResult._tag === "Failure") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "agent-session-live.publish-fault",
              message: `Fault logging failed: ${faultLogResult.failure.message}\nFault envelope publication failed: ${publishResult.failure.message}`,
              cause: {
                faultLogFailure: faultLogResult.failure,
                publishFailure: publishResult.failure,
              },
              details: {
                eventType: envelope.type,
                faultLogFailure: faultLogResult.failure,
                publishFailure: publishResult.failure,
              },
            }),
          );
        }
        if (faultLogResult._tag === "Failure") {
          return faultLogResult.failure;
        }
        if (publishResult._tag === "Failure") {
          return yield* Effect.fail(publishResult.failure);
        }
        return null;
      }
      yield* Effect.try({
        try: () => publish(envelope),
        catch: (cause) => toAgentSessionLiveEnvelopePublishError(cause, envelope.type),
      });
      if (persistence) {
        const persisted = yield* Effect.result(persistence.observe(envelope));
        if (persisted._tag === "Failure") {
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
              message: persisted.failure.message,
            });
          }
          return persisted.failure;
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
