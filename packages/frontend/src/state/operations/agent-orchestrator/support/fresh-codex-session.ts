import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "./session-prompt";

/** OpenDucktor already has the empty history before Codex stores its first turn. */
export const isFreshCodexSessionAwaitingKickoff = (session: AgentSessionState): boolean =>
  session.runtimeKind === "codex" &&
  session.status === "starting" &&
  session.livePresence !== "absent" &&
  session.historyLoadState === "loaded" &&
  session.messages.externalSessionId === session.externalSessionId &&
  session.messages.items.every(isSessionSystemPromptMessage);

export const isMatchingFreshCodexSessionAwaitingKickoff = (
  session: AgentSessionState | null | undefined,
  identity: AgentSessionIdentity | null | undefined,
): boolean =>
  session !== null &&
  session !== undefined &&
  matchesAgentSessionIdentity(session, identity) &&
  isFreshCodexSessionAwaitingKickoff(session);
