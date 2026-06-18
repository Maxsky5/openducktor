import type { AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "./messages";

type SessionTranscriptContent = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState"
>;

export const hasRenderableSessionTranscript = (session: SessionTranscriptContent): boolean =>
  getSessionMessageCount(session) > 0 || session.historyLoadState === "loaded";

export const needsInitialSessionHistoryLoad = (session: SessionTranscriptContent): boolean =>
  session.historyLoadState === "not_requested" && !hasRenderableSessionTranscript(session);
