import type { AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "../support/messages";

type SessionTranscriptContent = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState"
>;

export const hasLoadedSessionHistory = (
  session: Pick<AgentSessionState, "historyLoadState">,
): boolean => session.historyLoadState === "loaded";

export const hasRenderableSessionTranscript = (session: SessionTranscriptContent): boolean =>
  getSessionMessageCount(session) > 0 || hasLoadedSessionHistory(session);
