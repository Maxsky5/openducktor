import type {
  AgentSessionActivity,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { refreshWorkspaceFileQueries } from "./filesystem";
import { refreshGitWorkingDirectory } from "./git";

type ObservedSession = { ref: AgentSessionLiveRef; activity: AgentSessionActivity };

/**
 * Keeps the Git and file reads of a workspace current when its agents work unseen. A turn that
 * ends can have changed files, a commit, or the branch, so the reads of the session directory read
 * again: a shown view at once, and a hidden view when it shows. Every session of the observed
 * workspace counts, also a session that no view shows. A working session that the host removes
 * ends its turn too, so its directory reads again.
 */
export const createAgentTurnGitSync = (queryClient: QueryClient) => {
  const sessions = new Map<string, ObservedSession>();
  const refresh = ({ repoPath, workingDirectory }: AgentSessionLiveRef): void => {
    // Each view shows its own failed read.
    void refreshGitWorkingDirectory(queryClient, repoPath, workingDirectory).catch(() => {});
    void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
  };
  const observe = (session: AgentSessionLiveSnapshot): void => {
    const key = agentSessionIdentityKey(session.ref);
    const previous = sessions.get(key)?.activity;
    sessions.set(key, { ref: session.ref, activity: session.activity });
    if (previous === undefined || previous === "idle" || session.activity !== "idle") return;
    refresh(session.ref);
  };
  const remove = (key: string): void => {
    const session = sessions.get(key);
    sessions.delete(key);
    if (session && session.activity !== "idle") refresh(session.ref);
  };
  return (envelope: AgentSessionLiveEnvelope): void => {
    if (envelope.type === "snapshot") {
      // A snapshot holds every live session of the repository, so a missing session ended.
      const live = new Set(
        envelope.sessions.map((session) => agentSessionIdentityKey(session.ref)),
      );
      for (const key of sessions.keys()) {
        if (!live.has(key)) remove(key);
      }
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
    if (envelope.type === "session_removed") remove(agentSessionIdentityKey(envelope.ref));
  };
};
