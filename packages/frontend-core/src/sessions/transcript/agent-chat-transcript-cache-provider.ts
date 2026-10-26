import {
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { WorkspaceScopeContext } from "../../app-state/app-state-contexts";
import { AgentSessionsContext } from "../session-contexts";
import { createAgentChatTranscriptCacheKeeper } from "./agent-chat-transcript-cache-keeper";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";

const NO_REPO_PATHS: readonly string[] = Object.freeze([]);

/**
 * Keeps rendered transcripts across chat mounts while each chat keeps its own UI state. The
 * keeper updates the cached transcripts out of view, so a chat opens on its latest messages.
 * With `prepareActiveSessions`, it also builds the transcripts of the active sessions of all open
 * workspaces before the user opens them, as for a client that does not keep its chats mounted.
 */
export function AgentChatTranscriptCacheProvider({
  children,
  prepareActiveSessions,
}: {
  children: ReactNode;
  prepareActiveSessions?: { showThinkingMessages: boolean };
}): ReactElement {
  const store = useContext(AgentSessionsContext);
  const workspaces = useContext(WorkspaceScopeContext)?.workspaces;
  const [keeper] = useState(createAgentChatTranscriptCacheKeeper);
  const prepareThinking = prepareActiveSessions?.showThinkingMessages ?? null;
  const repoPaths = useMemo(
    () => workspaces?.map((workspace) => workspace.repoPath) ?? NO_REPO_PATHS,
    [workspaces],
  );
  useEffect(() => {
    if (!store) return;
    return keeper.follow({
      sessionStore: store,
      prepare:
        prepareThinking === null ? null : { showThinkingMessages: prepareThinking, repoPaths },
    });
  }, [keeper, prepareThinking, repoPaths, store]);
  return createElement(AgentChatTranscriptCacheContext.Provider, { value: keeper }, children);
}
