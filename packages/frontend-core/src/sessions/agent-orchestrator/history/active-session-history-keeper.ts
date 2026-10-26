import type { RuntimeKind } from "@openducktor/contracts";
import { useCallback, useEffect } from "react";
import { useRuntimeAvailabilityContext } from "../../../app-state/app-state-contexts";
import { deriveRuntimeReadiness } from "../../../lib/runtime-readiness";
import { useHostRuntimeStatusContext } from "../../session-contexts";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityActive,
} from "../../../lib/agent-session-activity-state";
import {
  agentSessionIdentityKey,
  toAgentSessionIdentity,
} from "../../../lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "../../../types/agent-orchestrator";
import { getSessionMessageAt, getSessionMessageCount } from "../support/messages";
import { runOrchestratorTask } from "../support/async-side-effects";
import { isFreshCodexSessionAwaitingKickoff } from "../support/fresh-codex-session";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";

/**
 * The most recent active sessions, and the most recent read transcripts, that stay current after
 * a live gap. Other sessions read their history when the user opens them.
 */
export const KEPT_RECENT_TRANSCRIPTS = 6;

type KeeperSessionStore = {
  subscribe: (listener: () => void) => () => void;
  listSessionSnapshots: () => readonly AgentSessionState[];
};

export type ActiveSessionHistoryKeeperInput = {
  sessionStore: KeeperSessionStore;
  loadHistory: (identity: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  isRuntimeReady: (runtimeKind: RuntimeKind) => boolean;
};

const lastActivityTime = (session: AgentSessionState): string => {
  const count = getSessionMessageCount(session);
  return getSessionMessageAt(session, count - 1)?.timestamp ?? session.startedAt;
};

const byRecentActivity = (left: AgentSessionState, right: AgentSessionState): number =>
  lastActivityTime(right).localeCompare(lastActivityTime(left));

const isBoundRoot = (session: AgentSessionState): boolean =>
  session.liveParentExternalSessionId === undefined &&
  session.sessionAssociation.kind !== "unbound";

/** A root session that works or waits for input. */
export const isActiveRootSession = (session: AgentSessionState): boolean =>
  isBoundRoot(session) &&
  isAgentSessionActivityActive(getAgentSessionActivityStateFromSession(session));

/** The root sessions that work or wait for input, the most recent activity first. */
export const listActiveRootSessions = (
  sessions: readonly AgentSessionState[],
): AgentSessionState[] => sessions.filter(isActiveRootSession).sort(byRecentActivity);

/**
 * The next session whose transcript needs a history read, or null. The most recent active
 * sessions come first: they work or wait for input. Then come stale transcripts among the most
 * recent read ones, as after a live gap. A failed read waits for the user, who opens the session or
 * selects Retry.
 */
export const pickNextKeptHistory = (
  sessions: readonly AgentSessionState[],
  isRuntimeReady: (runtimeKind: RuntimeKind) => boolean,
  attempted: ReadonlySet<string> = new Set(),
): AgentSessionState | null => {
  const needsRead = (session: AgentSessionState): boolean =>
    (session.historyLoadState === "not_requested" || session.historyLoadState === "stale") &&
    session.historyLoadFailure == null &&
    !attempted.has(agentSessionIdentityKey(session)) &&
    !isFreshCodexSessionAwaitingKickoff(session) &&
    isRuntimeReady(session.runtimeKind);
  const active = listActiveRootSessions(sessions).slice(0, KEPT_RECENT_TRANSCRIPTS).find(needsRead);
  if (active) return active;
  const recent = sessions
    .filter((session) => isBoundRoot(session) && hasLoadedSessionHistory(session))
    .sort(byRecentActivity)
    .slice(0, KEPT_RECENT_TRANSCRIPTS);
  return (
    recent.find((session) => session.historyLoadState === "stale" && needsRead(session)) ?? null
  );
};

/**
 * Keeps the transcripts of active and recent sessions of one workspace current, so a chat opens
 * on its latest messages. It reads one history at a time and reads again when the store changes,
 * as when a session starts to work or a live gap makes transcripts stale. Returns its stop.
 */
export const startActiveSessionHistoryKeeper = ({
  sessionStore,
  loadHistory,
  isRuntimeReady,
}: ActiveSessionHistoryKeeperInput): (() => void) => {
  let stopped = false;
  let reading = false;
  // A session reads once until its history loads. A read that ends without it, as when the
  // workspace changes, waits for the next load and gap instead of a loop of reads.
  const attempted = new Set<string>();
  const readNext = (): void => {
    if (stopped || reading) return;
    const sessions = sessionStore.listSessionSnapshots();
    for (const session of sessions) {
      if (session.historyLoadState === "loaded") attempted.delete(agentSessionIdentityKey(session));
    }
    const session = pickNextKeptHistory(sessions, isRuntimeReady, attempted);
    if (!session) return;
    reading = true;
    attempted.add(agentSessionIdentityKey(session));
    const identity = toAgentSessionIdentity(session);
    const done = (): void => {
      reading = false;
      readNext();
    };
    // The loader also records a failure on the session, which its view shows with Retry.
    void runOrchestratorTask("kept-session-history-load", () => loadHistory(identity), {
      tags: identity,
    }).then(done, done);
  };
  const unsubscribe = sessionStore.subscribe(readNext);
  readNext();
  return () => {
    stopped = true;
    unsubscribe();
  };
};

/**
 * Runs the history keeper for one workspace while `enabled`, as when its read model is ready.
 * Runtime readiness comes from the host runtime status, as for an open session.
 */
export const useActiveSessionHistoryKeeper = ({
  sessionStore,
  loadHistory,
  enabled,
}: {
  sessionStore: KeeperSessionStore | null;
  loadHistory: ((identity: AgentSessionIdentity) => Promise<AgentSessionState | null>) | null;
  enabled: boolean;
}): void => {
  const { allRuntimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const isRuntimeReady = useCallback(
    (runtimeKind: RuntimeKind) =>
      deriveRuntimeReadiness({
        hasWorkspace: true,
        runtimeDefinitions: allRuntimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeStatus,
        runtimeTarget: { kind: "runtime", runtimeKind },
      }).state === "ready",
    [allRuntimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError, runtimeStatus],
  );
  useEffect(() => {
    if (!enabled || !sessionStore || !loadHistory) return;
    return startActiveSessionHistoryKeeper({ sessionStore, loadHistory, isRuntimeReady });
  }, [enabled, isRuntimeReady, loadHistory, sessionStore]);
};
