import type { AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "./messages";

type SessionTranscriptContent = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState"
>;

export const hasLoadedSessionHistory = (
  session: Pick<AgentSessionState, "historyLoadState">,
): boolean => session.historyLoadState === "loaded";

export const hasRenderableSessionTranscript = (session: SessionTranscriptContent): boolean =>
  getSessionMessageCount(session) > 0 || hasLoadedSessionHistory(session);

export const needsInitialSessionHistoryLoad = (session: SessionTranscriptContent): boolean =>
  session.historyLoadState === "not_requested" && !hasRenderableSessionTranscript(session);
