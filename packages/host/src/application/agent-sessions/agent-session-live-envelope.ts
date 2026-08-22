import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";

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
      return {
        type: "catalog_invalidated",
        scope: {
          repoPath: change.repoPath,
          runtimeKind: change.runtimeKind,
          ...(() => {
            if (change.workingDirectory) {
              return { workingDirectory: change.workingDirectory };
            }
            return {};
          })(),
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
      return {
        type: "fault",
        repoPath: change.repoPath,
        message: change.message,
        ...(() => {
          if (change.operation) {
            return { operation: change.operation };
          }
          return {};
        })(),
        ...(() => {
          if (change.ref) {
            return { ref: change.ref };
          }
          return {};
        })(),
      };
  }
};

export const formatAgentSessionLiveFaultLog = (
  envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>,
): string =>
  `agent-session-live.fault ${JSON.stringify({
    repoPath: envelope.repoPath,
    message: envelope.message,
    ...(() => {
      if (envelope.operation) {
        return { operation: envelope.operation };
      }
      return {};
    })(),
    ...(() => {
      if (envelope.ref) {
        return {
          runtimeKind: envelope.ref.runtimeKind,
          workingDirectory: envelope.ref.workingDirectory,
          externalSessionId: envelope.ref.externalSessionId,
        };
      }
      return {};
    })(),
  })}`;

export const toAgentSessionLiveEnvelopePublishError = (
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
