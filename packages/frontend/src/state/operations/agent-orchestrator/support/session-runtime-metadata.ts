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

const missingPersistedSessionRuntimeKindMessage = (externalSessionId: string): string =>
  `Persisted session '${externalSessionId}' is missing runtime kind metadata.`;

const missingPersistedSelectedModelRuntimeKindMessage = (externalSessionId: string): string =>
  `Persisted session '${externalSessionId}' selected model is missing runtime kind metadata.`;

const missingSessionRuntimeKindMessage = (externalSessionId: string): string =>
  `Session '${externalSessionId}' is missing runtime kind metadata.`;

const missingEnsuredSessionRuntimeKindMessage = (externalSessionId: string): string =>
  `Session '${externalSessionId}' ensured runtime is missing runtime kind metadata.`;

const missingEnsuredSelectedModelRuntimeKindMessage = (): string =>
  "Selected model ensured runtime is missing runtime kind metadata.";

const missingSelectedModelRuntimeKindMessage = (externalSessionId: string): string =>
  `Session '${externalSessionId}' selected model is missing runtime kind metadata.`;

export const startSessionRuntimeKindRequiredMessage = (role: AgentSessionState["role"]): string =>
  `Runtime kind is required to start ${role} sessions. Select an explicit runtime before starting a session.`;

export const readPersistedRuntimeKind = ({
  externalSessionId,
  runtimeKind,
}: Pick<AgentSessionRecord, "externalSessionId" | "runtimeKind">): RuntimeKind => {
  return requireRuntimeKindMetadata(
    runtimeKind,
    missingPersistedSessionRuntimeKindMessage(externalSessionId),
  );
};

export const requirePersistedSelectedModelRuntimeKind = (
  externalSessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionRecord["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionRecord["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    missingPersistedSelectedModelRuntimeKindMessage(externalSessionId),
  );

  if (runtimeKind !== sessionRuntimeKind) {
    throwSessionRuntimeMetadataError(
      `Persisted session '${externalSessionId}' selected model runtime kind does not match session runtime kind.`,
    );
  }

  return runtimeKind as NonNullable<typeof selectedModel.runtimeKind>;
};

export const requireSessionRuntimeKindForPersistence = (
  session: Pick<AgentSessionState, "externalSessionId" | "runtimeKind">,
): NonNullable<AgentSessionState["runtimeKind"]> => {
  return requireRuntimeKindMetadata(
    session.runtimeKind,
    missingSessionRuntimeKindMessage(session.externalSessionId),
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
  externalSessionId,
  requestedRuntimeKind,
  ensuredRuntimeKind,
}: {
  externalSessionId: string;
  requestedRuntimeKind: RuntimeKind;
  ensuredRuntimeKind: RuntimeKind | string | null | undefined;
}): RuntimeKind => {
  const normalizedEnsuredRuntimeKind = requireRuntimeKindMetadata(
    ensuredRuntimeKind,
    missingEnsuredSessionRuntimeKindMessage(externalSessionId),
  );
  if (normalizedEnsuredRuntimeKind === requestedRuntimeKind) {
    return normalizedEnsuredRuntimeKind;
  }

  throwSessionRuntimeMetadataError(
    `Session '${externalSessionId}' runtime kind metadata '${requestedRuntimeKind}' does not match ensured runtime kind '${normalizedEnsuredRuntimeKind}'.`,
  );
  throw new Error("unreachable");
};

export const assertSelectedModelRuntimeKindMatchesEnsuredRuntime = ({
  selectedModelRuntimeKind,
  ensuredRuntimeKind,
}: {
  selectedModelRuntimeKind: RuntimeKind;
  ensuredRuntimeKind: RuntimeKind | string | null | undefined;
}): RuntimeKind => {
  const normalizedEnsuredRuntimeKind = requireRuntimeKindMetadata(
    ensuredRuntimeKind,
    missingEnsuredSelectedModelRuntimeKindMessage(),
  );
  if (normalizedEnsuredRuntimeKind === selectedModelRuntimeKind) {
    return normalizedEnsuredRuntimeKind;
  }

  throwSessionRuntimeMetadataError(
    `Selected model runtime kind '${selectedModelRuntimeKind}' does not match ensured runtime kind '${normalizedEnsuredRuntimeKind}'.`,
  );
  throw new Error("unreachable");
};

export const requireSelectedModelRuntimeKindForPersistence = (
  externalSessionId: string,
  sessionRuntimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  selectedModel: NonNullable<AgentSessionState["selectedModel"]>,
): NonNullable<typeof selectedModel.runtimeKind> => {
  const runtimeKind = requireRuntimeKindMetadata(
    selectedModel.runtimeKind,
    missingSelectedModelRuntimeKindMessage(externalSessionId),
  );

  if (runtimeKind !== sessionRuntimeKind) {
    throwSessionRuntimeMetadataError(
      `Session '${externalSessionId}' selected model runtime kind does not match session runtime kind.`,
    );
  }

  return runtimeKind as NonNullable<typeof selectedModel.runtimeKind>;
};

export const isSessionRuntimeMetadataError = (
  error: unknown,
): error is SessionRuntimeMetadataError => {
  return error instanceof SessionRuntimeMetadataError;
};
