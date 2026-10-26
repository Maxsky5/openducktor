import { createContext } from "react";
import type { AgentChatTranscriptCacheKeeper } from "./agent-chat-transcript-cache-keeper";

export const AgentChatTranscriptCacheContext = createContext<AgentChatTranscriptCacheKeeper | null>(
  null,
);
