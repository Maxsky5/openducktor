import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";

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

export const formatAgentSessionLiveFaultLog = (envelope: AgentSessionLiveFaultEnvelope): string => {
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

export const toAgentSessionLiveEnvelopePublishError = (
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
