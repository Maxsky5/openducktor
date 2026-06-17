import {
  type AgentSessionRecord,
  type RuntimeKind,
  runtimeKindSchema,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";

const readRuntimeKind = (
  runtimeKind: RuntimeKind | string | null | undefined,
  missingMessage: string,
): RuntimeKind => {
  if (!runtimeKind) {
    throw new Error(missingMessage);
  }

  const parsed = runtimeKindSchema.safeParse(runtimeKind);
  if (!parsed.success) {
    throw new Error(`Unsupported runtime kind '${runtimeKind}'.`);
  }

  return parsed.data;
};

const requireRuntimeKindMatch = (
  runtimeKind: RuntimeKind,
  sessionRuntimeKind: RuntimeKind,
  message: string,
): RuntimeKind => {
  if (runtimeKind !== sessionRuntimeKind) {
    throw new Error(message);
  }

  return runtimeKind;
};

export const readPersistedSessionRuntimeKind = ({
  externalSessionId,
  runtimeKind,
}: Pick<AgentSessionRecord, "externalSessionId" | "runtimeKind">): RuntimeKind =>
  readRuntimeKind(runtimeKind, `Persisted session '${externalSessionId}' is missing runtime kind.`);

export const readFreshSessionRuntimeKind = (
  role: AgentRole,
  selectedModel: Pick<AgentModelSelection, "runtimeKind">,
): RuntimeKind =>
  readRuntimeKind(
    selectedModel.runtimeKind,
    `Runtime kind is required to start ${role} sessions. Select an explicit runtime before starting a session.`,
  );

export const readPersistedSelectedModelRuntimeKind = (
  externalSessionId: string,
  sessionRuntimeKind: RuntimeKind,
  selectedModel: Pick<AgentModelSelection, "runtimeKind">,
): RuntimeKind =>
  requireRuntimeKindMatch(
    readRuntimeKind(
      selectedModel.runtimeKind,
      `Persisted session '${externalSessionId}' selected model is missing runtime kind.`,
    ),
    sessionRuntimeKind,
    `Persisted session '${externalSessionId}' selected model runtime kind does not match session runtime kind.`,
  );

export const readSessionSelectedModelRuntimeKindForPersistence = (
  externalSessionId: string,
  sessionRuntimeKind: RuntimeKind,
  selectedModel: Pick<AgentModelSelection, "runtimeKind">,
): RuntimeKind =>
  requireRuntimeKindMatch(
    readRuntimeKind(
      selectedModel.runtimeKind,
      `Session '${externalSessionId}' selected model is missing runtime kind.`,
    ),
    sessionRuntimeKind,
    `Session '${externalSessionId}' selected model runtime kind does not match session runtime kind.`,
  );
