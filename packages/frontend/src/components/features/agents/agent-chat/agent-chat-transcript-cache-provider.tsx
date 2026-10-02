import { type ReactNode, useState } from "react";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import { createTranscriptModelCache } from "./agent-chat-transcript-model-cache";

/** Keeps rendered transcripts across chat mounts while each chat keeps its own UI state. */
export function AgentChatTranscriptCacheProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(createTranscriptModelCache);
  return (
    <AgentChatTranscriptCacheContext.Provider value={cache}>
      {children}
    </AgentChatTranscriptCacheContext.Provider>
  );
}
