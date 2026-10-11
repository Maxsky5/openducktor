import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type SessionHistoryVersion = { epoch: number; revision: number };

type Coverage = {
  ready: boolean;
  epoch: number;
  revisions: Map<string, number>;
  sessions: Map<string, { parent: AgentSessionIdentity | null; historyState: string }>;
};

/** The rail's existing subscriptions prove history freshness, including inactive workspaces. */
export const createSessionHistoryCoverage = (queryClient: QueryClient) => {
  const repositories = new Map<string, Coverage>();
  const read = (repoPath: string, identity: AgentSessionIdentity): SessionHistoryVersion | null => {
    const coverage = repositories.get(normalizeWorkingDirectory(repoPath));
    return coverage?.ready && coverage.sessions.has(agentSessionIdentityKey(identity))
      ? {
          epoch: coverage.epoch,
          revision: coverage.revisions.get(agentSessionIdentityKey(identity)) ?? 0,
        }
      : null;
  };
  const isCurrent = (
    repoPath: string,
    identity: AgentSessionIdentity,
    version: SessionHistoryVersion | null,
  ): boolean => {
    const current = read(repoPath, identity);
    return (
      version !== null &&
      current !== null &&
      version.epoch === current.epoch &&
      version.revision === current.revision
    );
  };

  const observe = (repoPath: string) => {
    const repo = normalizeWorkingDirectory(repoPath);
    const previous = repositories.get(repo);
    const coverage: Coverage = {
      ready: false,
      epoch: (previous?.epoch ?? 0) + 1,
      revisions: new Map(),
      sessions: new Map(),
    };
    repositories.set(repo, coverage);
    const invalidate = (identity?: AgentSessionIdentity): void => {
      void queryClient.invalidateQueries({
        queryKey: identity
          ? [
              "agent-session-history",
              repo,
              identity.runtimeKind,
              normalizeWorkingDirectory(identity.workingDirectory),
              identity.externalSessionId,
            ]
          : ["agent-session-history", repo],
        refetchType: "none",
      });
    };
    const change = (identity: AgentSessionIdentity): void => {
      const visited = new Set<string>();
      let current: AgentSessionIdentity | undefined = identity;
      while (current) {
        const key = agentSessionIdentityKey(current);
        if (visited.has(key)) break;
        visited.add(key);
        coverage.revisions.set(key, (coverage.revisions.get(key) ?? 0) + 1);
        invalidate(current);
        current = coverage.sessions.get(key)?.parent ?? undefined;
      }
    };
    const rememberSession = (session: AgentSessionLiveSnapshot): boolean => {
      const { ref, parentExternalSessionId, activity, executionEpisodeId, pendingQuestions } =
        session;
      const key = agentSessionIdentityKey(ref);
      const historyState = JSON.stringify([
        parentExternalSessionId,
        activity,
        executionEpisodeId,
        pendingQuestions,
      ]);
      const changed = coverage.sessions.get(key)?.historyState !== historyState;
      coverage.sessions.set(key, {
        parent: parentExternalSessionId
          ? { ...ref, externalSessionId: parentExternalSessionId }
          : null,
        historyState,
      });
      return changed;
    };
    invalidate();
    return {
      accept(envelope: AgentSessionLiveEnvelope): void {
        if (repositories.get(repo) !== coverage) return;
        switch (envelope.type) {
          case "snapshot":
            // A repeated connection snapshot is the transport's repair for an actual gap.
            if (coverage.ready || envelope.historyReplayGap) coverage.epoch += 1;
            coverage.ready = true;
            coverage.sessions.clear();
            for (const session of envelope.sessions) rememberSession(session);
            invalidate();
            break;
          case "transcript_event":
            change(envelope.event.sessionRef);
            break;
          case "session_upsert":
            if (rememberSession(envelope.session)) change(envelope.session.ref);
            break;
          case "session_removed":
            change(envelope.ref);
            coverage.sessions.delete(agentSessionIdentityKey(envelope.ref));
            break;
          case "fault":
            if (envelope.ref) change(envelope.ref);
            else {
              coverage.ready = false;
              coverage.epoch += 1;
              invalidate();
            }
            break;
          case "task_session_records_updated":
            if (envelope.liveSession && rememberSession(envelope.liveSession)) {
              change(envelope.liveSession.ref);
            }
            break;
          case "catalog_invalidated":
          case "slash_command_catalog_updated":
            break;
        }
      },
      close(): void {
        if (repositories.get(repo) !== coverage) return;
        coverage.ready = false;
        coverage.epoch += 1;
        invalidate();
      },
    };
  };
  const isObserved = (repoPath: string): boolean =>
    repositories.get(normalizeWorkingDirectory(repoPath))?.ready === true;
  return { read, isCurrent, isObserved, observe };
};

export type SessionHistoryCoverage = ReturnType<typeof createSessionHistoryCoverage>;
const owners = new WeakMap<QueryClient, SessionHistoryCoverage>();

export const sessionHistoryCoverage = (queryClient: QueryClient): SessionHistoryCoverage => {
  let owner = owners.get(queryClient);
  if (!owner) {
    owner = createSessionHistoryCoverage(queryClient);
    owners.set(queryClient, owner);
  }
  return owner;
};
