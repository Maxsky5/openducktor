import { runtimeKindSchema } from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentSessionIdentityLike = Pick<
  AgentSessionIdentity,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
>;

const SESSION_IDENTITY_KEY_SEPARATOR = "|";

const encodeSessionIdentityPart = (value: string): string => encodeURIComponent(value);

const decodeSessionIdentityPart = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const agentSessionIdentityKey = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: AgentSessionIdentityLike): string =>
  [
    encodeSessionIdentityPart(externalSessionId),
    encodeSessionIdentityPart(runtimeKind),
    encodeSessionIdentityPart(normalizeWorkingDirectory(workingDirectory)),
  ].join(SESSION_IDENTITY_KEY_SEPARATOR);

export const matchesAgentSessionIdentity = (
  session: AgentSessionIdentityLike | null | undefined,
  target: AgentSessionIdentityLike | null | undefined,
): session is AgentSessionIdentityLike =>
  session !== null &&
  session !== undefined &&
  target !== null &&
  target !== undefined &&
  agentSessionIdentityKey(session) === agentSessionIdentityKey(target);

export const toAgentSessionIdentity = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: AgentSessionIdentityLike): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
});

export const parseAgentSessionIdentityKey = (
  sessionKey: string | null | undefined,
): AgentSessionIdentity | null => {
  if (!sessionKey) {
    return null;
  }

  const parts = sessionKey.split(SESSION_IDENTITY_KEY_SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }

  const [encodedExternalSessionId, encodedRuntimeKind, encodedWorkingDirectory] = parts;
  const externalSessionId = decodeSessionIdentityPart(encodedExternalSessionId ?? "")?.trim();
  const runtimeKind = runtimeKindSchema.safeParse(
    decodeSessionIdentityPart(encodedRuntimeKind ?? "")?.trim(),
  );
  const workingDirectory = normalizeWorkingDirectory(
    decodeSessionIdentityPart(encodedWorkingDirectory ?? "") ?? "",
  );

  if (!externalSessionId || !runtimeKind.success || !workingDirectory) {
    return null;
  }

  return {
    externalSessionId,
    runtimeKind: runtimeKind.data,
    workingDirectory,
  };
};
