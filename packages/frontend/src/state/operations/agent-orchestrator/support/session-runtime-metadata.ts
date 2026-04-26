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

const requireRuntimeKindMetadata = (
  runtimeKind: string | null | undefined,
  message: string,
): RuntimeKind => {
  const trimmedRuntimeKind = runtimeKind?.trim();
  if (!trimmedRuntimeKind) {
    throwSessionRuntimeMetadataError(message);
  }

  return trimmedRuntimeKind as RuntimeKind;
};

export const readPersistedRuntimeKind = ({
  sessionId,
  runtimeKind,
}: Pick<AgentSessionRecord, "sessionId" | "runtimeKind">): RuntimeKind => {
  return requireRuntimeKindMetadata(
    runtimeKind,
    `Persisted session '${sessionId}' is missing runtime kind metadata.`,
  );
};

export const requirePersistedSelectedModelRuntimeKind = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionRecord["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionRecord["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    `Persisted session '${sessionId}' selected model is missing runtime kind metadata.`,
  );

  if (runtimeKind !== sessionRuntimeKind) {
    throwSessionRuntimeMetadataError(
      `Persisted session '${sessionId}' selected model runtime kind does not match session runtime kind.`,
    );
  }

  return runtimeKind as NonNullable<typeof selectedModel.runtimeKind>;
};

export const requireSessionRuntimeKindForPersistence = (
  session: Pick<AgentSessionState, "sessionId" | "runtimeKind">,
): NonNullable<AgentSessionState["runtimeKind"]> => {
  return requireRuntimeKindMetadata(
    session.runtimeKind,
    `Session '${session.sessionId}' is missing runtime kind metadata.`,
  ) as NonNullable<AgentSessionState["runtimeKind"]>;
};

export const requireSelectedModelRuntimeKindForPersistence = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionState["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    `Session '${sessionId}' selected model is missing runtime kind metadata.`,
  );

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
