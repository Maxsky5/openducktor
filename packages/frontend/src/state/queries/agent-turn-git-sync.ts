import type {
  AgentSessionActivity,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { refreshWorkspaceFileQueries } from "./filesystem";
import { refreshGitWorkingDirectory } from "./git";

/**
 * Keeps the Git and file reads of a workspace current when its agents work unseen. A turn that
 * ends can have changed files, a commit, or the branch, so the reads of the session directory read
 * again: a shown view at once, and a hidden view when it shows. Every session of the observed
 * workspace counts, also a session that no view shows.
 */
export const createAgentTurnGitSync = (queryClient: QueryClient) => {
  const activities = new Map<string, AgentSessionActivity>();
  const observe = (session: AgentSessionLiveSnapshot): void => {
    const key = agentSessionIdentityKey(session.ref);
    const previous = activities.get(key);
    activities.set(key, session.activity);
    if (previous === undefined || previous === "idle" || session.activity !== "idle") return;
    const { repoPath, workingDirectory } = session.ref;
    // Each view shows its own failed read.
    void refreshGitWorkingDirectory(queryClient, repoPath, workingDirectory).catch(() => {});
    void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
  };
  return (envelope: AgentSessionLiveEnvelope): void => {
    if (envelope.type === "snapshot") {
      for (const session of envelope.sessions) observe(session);
      return;
    }
    if (envelope.type === "session_upsert") {
      observe(envelope.session);
      return;
    }
    if (envelope.type === "task_session_records_updated" && envelope.liveSession) {
      observe(envelope.liveSession);
      return;
    }
    if (envelope.type === "session_removed")
      activities.delete(agentSessionIdentityKey(envelope.ref));
  };
};
