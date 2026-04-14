import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export class SessionRuntimeMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRuntimeMetadataError";
  }
}

const throwSessionRuntimeMetadataError = (message: string): never => {
  throw new SessionRuntimeMetadataError(message);
};

export const readPersistedRuntimeKind = ({
  sessionId,
  runtimeKind,
}: Pick<AgentSessionRecord, "sessionId" | "runtimeKind">): RuntimeKind => {
  if (!runtimeKind) {
    throwSessionRuntimeMetadataError(
      `Persisted session '${sessionId}' is missing runtime kind metadata.`,
    );
  }

  return runtimeKind;
};

export const requirePersistedSelectedModelRuntimeKind = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionRecord["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionRecord["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  if (!selectedModel.runtimeKind) {
    throwSessionRuntimeMetadataError(
      `Persisted session '${sessionId}' selected model is missing runtime kind metadata.`,
    );
  }

  if (selectedModel.runtimeKind !== sessionRuntimeKind) {
    throwSessionRuntimeMetadataError(
      `Persisted session '${sessionId}' selected model runtime kind does not match session runtime kind.`,
    );
  }

  return selectedModel.runtimeKind as NonNullable<typeof selectedModel.runtimeKind>;
};

export const requireSessionRuntimeKindForPersistence = (
  session: Pick<AgentSessionState, "sessionId" | "runtimeKind">,
): NonNullable<AgentSessionState["runtimeKind"]> => {
  const runtimeKind = session.runtimeKind;
  if (!runtimeKind) {
    throwSessionRuntimeMetadataError(
      `Session '${session.sessionId}' is missing runtime kind metadata.`,
    );
  }

  return runtimeKind as NonNullable<AgentSessionState["runtimeKind"]>;
};

export const requireSelectedModelRuntimeKindForPersistence = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionState["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = selectedModel.runtimeKind;
  if (!runtimeKind) {
    throwSessionRuntimeMetadataError(
      `Session '${sessionId}' selected model is missing runtime kind metadata.`,
    );
  }

  if (runtimeKind !== sessionRuntimeKind) {
    throwSessionRuntimeMetadataError(
      `Session '${sessionId}' selected model runtime kind does not match session runtime kind.`,
    );
  }

  return runtimeKind as NonNullable<typeof selectedModel.runtimeKind>;
};

export const isSessionRuntimeMetadataError = (
  error: unknown,
): error is SessionRuntimeMetadataError => {
  return error instanceof SessionRuntimeMetadataError;
};
