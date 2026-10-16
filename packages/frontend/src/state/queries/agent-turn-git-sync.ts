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

/** Tool calls that can change files, a commit, or the branch while a turn runs. */
const CHANGING_TOOL_TYPES: ReadonlySet<string> = new Set(["file_edit", "bash"]);
/** The directory reads again once after a burst of tool calls, not after each call. */
export const TOOL_CHANGE_SETTLE_MS = 1_000;

export type AgentTurnGitSync = {
  observe: (envelope: AgentSessionLiveEnvelope) => void;
  /** Stops the reads that wait for a burst of tool calls to end. */
  dispose: () => void;
};

/**
 * Keeps the Git and file reads of a workspace current while its agents work, also unseen. A tool
 * call that edits files or runs a command, and a turn that ends, can change files, a commit, or the
 * branch. So the reads of the session directory read again: a shown view at once and in place, and
 * a hidden view when it shows. Every session of the observed workspace counts, also a session that
 * no view shows. A working session that the host removes ends its turn too.
 */
export const createAgentTurnGitSync = (queryClient: QueryClient): AgentTurnGitSync => {
  const sessions = new Map<string, ObservedSession>();
  const settling = new Map<string, ReturnType<typeof setTimeout>>();
  const directoryKey = ({ repoPath, workingDirectory }: AgentSessionLiveRef): string =>
    JSON.stringify([repoPath, workingDirectory]);
  const stopSettling = (key: string): void => {
    clearTimeout(settling.get(key));
    settling.delete(key);
  };
  const refresh = (ref: AgentSessionLiveRef): void => {
    // This read covers the tool calls that wait to settle.
    stopSettling(directoryKey(ref));
    const { repoPath, workingDirectory } = ref;
    // Each view shows its own failed read.
    void refreshGitWorkingDirectory(queryClient, repoPath, workingDirectory).catch(() => {});
    void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
  };
  const refreshAfterToolCalls = (ref: AgentSessionLiveRef): void => {
    const key = directoryKey(ref);
    stopSettling(key);
    settling.set(
      key,
      setTimeout(() => refresh(ref), TOOL_CHANGE_SETTLE_MS),
    );
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
  return {
    observe: (envelope) => {
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
      if (envelope.type === "session_removed") {
        remove(agentSessionIdentityKey(envelope.ref));
        return;
      }
      // A replayed baseline holds old tool calls, which the shown reads already include.
      if (envelope.type !== "transcript_event" || envelope.provenance === "baseline") return;
      const { event } = envelope;
      if (
        event.type === "assistant_part" &&
        event.part.kind === "tool" &&
        (event.part.status === "completed" || event.part.status === "error") &&
        CHANGING_TOOL_TYPES.has(event.part.toolType)
      ) {
        refreshAfterToolCalls(event.sessionRef);
      }
    },
    dispose: () => {
      for (const timer of settling.values()) clearTimeout(timer);
      settling.clear();
    },
  };
};
