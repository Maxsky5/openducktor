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

const missingPersistedSessionRuntimeKindMessage = (sessionId: string): string =>
  `Persisted session '${sessionId}' is missing runtime kind metadata.`;

const missingPersistedSelectedModelRuntimeKindMessage = (sessionId: string): string =>
  `Persisted session '${sessionId}' selected model is missing runtime kind metadata.`;

const missingSessionRuntimeKindMessage = (sessionId: string): string =>
  `Session '${sessionId}' is missing runtime kind metadata.`;

const missingSelectedModelRuntimeKindMessage = (sessionId: string): string =>
  `Session '${sessionId}' selected model is missing runtime kind metadata.`;

export const startSessionRuntimeKindRequiredMessage = (role: AgentSessionState["role"]): string =>
  `Runtime kind is required to start ${role} sessions. Select an explicit runtime before starting a session.`;

export const readPersistedRuntimeKind = ({
  sessionId,
  runtimeKind,
}: Pick<AgentSessionRecord, "sessionId" | "runtimeKind">): RuntimeKind => {
  return requireRuntimeKindMetadata(
    runtimeKind,
    missingPersistedSessionRuntimeKindMessage(sessionId),
  );
};

export const requirePersistedSelectedModelRuntimeKind = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionRecord["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionRecord["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    missingPersistedSelectedModelRuntimeKindMessage(sessionId),
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
    missingSessionRuntimeKindMessage(session.sessionId),
  ) as NonNullable<AgentSessionState["runtimeKind"]>;
};

export const requireSessionRuntimeKind = (
  session: Pick<AgentSessionState, "sessionId" | "runtimeKind" | "selectedModel">,
): NonNullable<AgentSessionState["runtimeKind"]> => {
  return requireRuntimeKindMetadata(
    session.runtimeKind ?? session.selectedModel?.runtimeKind,
    missingSessionRuntimeKindMessage(session.sessionId),
  ) as NonNullable<AgentSessionState["runtimeKind"]>;
};

export const requireSelectedModelRuntimeKindForStart = (
  role: AgentSessionState["role"],
  selectedModel: Pick<NonNullable<AgentSessionState["selectedModel"]>, "runtimeKind">,
): NonNullable<NonNullable<AgentSessionState["selectedModel"]>["runtimeKind"]> => {
  return requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    startSessionRuntimeKindRequiredMessage(role),
  ) as NonNullable<NonNullable<AgentSessionState["selectedModel"]>["runtimeKind"]>;
};

export const assertSessionRuntimeKindMatchesEnsuredRuntime = ({
  sessionId,
  requestedRuntimeKind,
  ensuredRuntimeKind,
}: {
  sessionId: string;
  requestedRuntimeKind: RuntimeKind;
  ensuredRuntimeKind: RuntimeKind | string | null | undefined;
}): void => {
  if (!ensuredRuntimeKind || ensuredRuntimeKind === requestedRuntimeKind) {
    return;
  }

  throwSessionRuntimeMetadataError(
    `Session '${sessionId}' runtime kind metadata '${requestedRuntimeKind}' does not match ensured runtime kind '${ensuredRuntimeKind}'.`,
  );
};

export const assertSelectedModelRuntimeKindMatchesEnsuredRuntime = ({
  selectedModelRuntimeKind,
  ensuredRuntimeKind,
}: {
  selectedModelRuntimeKind: RuntimeKind;
  ensuredRuntimeKind: RuntimeKind | string | null | undefined;
}): void => {
  if (!ensuredRuntimeKind || ensuredRuntimeKind === selectedModelRuntimeKind) {
    return;
  }

  throwSessionRuntimeMetadataError(
    `Selected model runtime kind '${selectedModelRuntimeKind}' does not match ensured runtime kind '${ensuredRuntimeKind}'.`,
  );
};

export const requireSelectedModelRuntimeKindForPersistence = (
  sessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionState["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    missingSelectedModelRuntimeKindMessage(sessionId),
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
