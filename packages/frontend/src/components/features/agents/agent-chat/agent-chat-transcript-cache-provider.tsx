import { type ReactElement, type ReactNode, useContext, useEffect, useState } from "react";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import { createTranscriptModelCache } from "./agent-chat-transcript-model-cache";

/** Keeps rendered transcripts across chat mounts while each chat keeps its own UI state. */
export function AgentChatTranscriptCacheProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const store = useContext(AgentSessionsContext);
  const [cache] = useState(createTranscriptModelCache);
  useEffect(() => {
    if (!store) return;
    const prune = () => {
      for (const [key, entry] of cache) {
        if (
          entry.lifetime !== null &&
          store.getSessionSource(entry.session)?.lifetime !== entry.lifetime
        ) {
          cache.delete(key);
        }
      }
    };
    const stop = store.subscribe(prune);
    prune();
    return stop;
  }, [cache, store]);
  return (
    <AgentChatTranscriptCacheContext.Provider value={cache}>
      {children}
    </AgentChatTranscriptCacheContext.Provider>
  );
}
