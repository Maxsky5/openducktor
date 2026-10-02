import { createContext, type ReactNode, useState } from "react";
import {
  createTranscriptModelCache,
  type TranscriptModelCache,
} from "./agent-chat-transcript-model-cache";

export const AgentChatTranscriptCacheContext = createContext<TranscriptModelCache | null>(null);

/** Keeps rendered transcripts across chat mounts while each chat keeps its own UI state. */
export function AgentChatTranscriptCacheProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(createTranscriptModelCache);
  return (
    <AgentChatTranscriptCacheContext.Provider value={cache}>
      {children}
    </AgentChatTranscriptCacheContext.Provider>
  );
}
