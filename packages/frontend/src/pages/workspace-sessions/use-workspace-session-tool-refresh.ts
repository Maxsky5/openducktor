import { useEffect, useRef } from "react";
import { shouldRefreshGitPanelAfterToolCompletion } from "@/features/agent-studio-build-tools/git-panel-refresh-policy";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { forEachSessionMessage } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type SeenTools = {
  sessionKey: string;
  wasLoading: boolean;
  ids: Set<string>;
};

export function useWorkspaceSessionToolRefresh(
  session: AgentSessionState | null,
  refresh: () => void,
): void {
  const seen = useRef<SeenTools | null>(null);

  useEffect(() => {
    if (!session) {
      seen.current = null;
      return;
    }
    const sessionKey = agentSessionIdentityKey(session);
    const isLoading = session.historyLoadState === "loading";
    if (
      !seen.current ||
      seen.current.sessionKey !== sessionKey ||
      isLoading ||
      seen.current.wasLoading
    ) {
      seen.current = {
        sessionKey,
        wasLoading: isLoading,
        ids: completedToolIds(session, sessionKey),
      };
      return;
    }

    let changedFiles = false;
    forEachSessionMessage(session, (message) => {
      const meta = message.meta;
      if (meta?.kind !== "tool" || meta.status !== "completed") return;
      const id = `${sessionKey}:${message.id}`;
      if (seen.current?.ids.has(id)) return;
      seen.current?.ids.add(id);
      if (shouldRefreshGitPanelAfterToolCompletion(meta)) changedFiles = true;
    });
    if (changedFiles) refresh();
  }, [session, refresh]);
}

function completedToolIds(session: AgentSessionState, sessionKey: string): Set<string> {
  const ids = new Set<string>();
  forEachSessionMessage(session, (message) => {
    if (message.meta?.kind === "tool" && message.meta.status === "completed") {
      ids.add(`${sessionKey}:${message.id}`);
    }
  });
  return ids;
}
