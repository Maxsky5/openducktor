import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentSessionIdentityLike = Pick<
  AgentSessionIdentity,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
>;

const SESSION_IDENTITY_KEY_SEPARATOR = "\u0000";

export const agentSessionIdentityKey = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: AgentSessionIdentityLike): string =>
  [externalSessionId, runtimeKind, normalizeWorkingDirectory(workingDirectory)].join(
    SESSION_IDENTITY_KEY_SEPARATOR,
  );

export const matchesAgentSessionIdentity = (
  session: AgentSessionIdentityLike | null | undefined,
  target: AgentSessionIdentityLike | null | undefined,
): session is AgentSessionIdentityLike =>
  session !== null &&
  session !== undefined &&
  target !== null &&
  target !== undefined &&
  agentSessionIdentityKey(session) === agentSessionIdentityKey(target);
