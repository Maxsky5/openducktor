import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionState } from "../../types/agent-orchestrator";
import {
  isActiveRootSession,
  listActiveRootSessions,
} from "../agent-orchestrator/history/active-session-history-keeper";
import {
  areSessionMessagesSameRevision,
  getSessionMessageCount,
} from "../agent-orchestrator/support/messages";
import type { AgentSessionsStore } from "../agent-sessions-store";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import {
  buildTranscriptModelInChunks,
  updateTranscriptModelAtOnce,
} from "./agent-chat-transcript-model-build";
import type { AgentChatTranscriptModel } from "./agent-chat-transcript-model";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";
import {
  createTranscriptModelCache,
  MAX_CACHED_TRANSCRIPTS,
  type TranscriptModelCache,
  type TranscriptModelCacheEntry,
  transcriptModelCacheKey,
  writeTranscriptModelCacheEntry,
} from "./agent-chat-transcript-model-cache";
import { withClaudeSkillMentions } from "./claude-skill-mentions";

/** The time that live changes collect before the keeper updates the transcripts out of view. */
export const TRANSCRIPT_KEEP_DELAY_MS = 500;

/** The active sessions whose transcripts the keeper builds before the user opens them. */
export type PreparedActiveTranscripts = {
  showThinkingMessages: boolean;
  repoPaths: readonly string[];
};

export type AgentChatTranscriptCacheKeeper = {
  cache: TranscriptModelCache;
  /** A mounted transcript builds its own session, so the keeper leaves it. Returns the release. */
  show: (sessionKey: string) => () => void;
  /** Keeps the cached transcripts current with the session store. Returns the stop. */
  follow: (input: {
    sessionStore: AgentSessionsStore;
    prepare: PreparedActiveTranscripts | null;
  }) => () => void;
};

type Messages = AgentChatTranscriptSession["messages"];

type KeeperBuild = {
  baseline: Messages;
  /** A prepared transcript is not in the cache until its build completes. */
  prepares: boolean;
  stop: () => void;
};

type Following = {
  schedule: () => void;
  stopBuilds: (sessionKey: string) => void;
};

const isSameRevision = (externalSessionId: string, left: Messages, right: Messages): boolean =>
  areSessionMessagesSameRevision(
    { externalSessionId, messages: left },
    { externalSessionId, messages: right },
  );

const toTranscriptSession = (
  session: AgentSessionState,
  skillReferences: AgentChatTranscriptSession["skillReferences"],
): AgentChatTranscriptSession => {
  const transcriptSession = toAgentChatTranscriptSession(session);
  return skillReferences
    ? { ...withClaudeSkillMentions(transcriptSession, skillReferences), skillReferences }
    : transcriptSession;
};

/**
 * Keeps the rendered transcripts of sessions out of view current, so a chat opens on its latest
 * messages at once. It gathers live changes for `TRANSCRIPT_KEEP_DELAY_MS` and then updates each
 * changed transcript. A small change updates at once. A full build runs in short slices, one
 * build at a time, so input stays fast while the user works elsewhere. When the app asks for it,
 * the keeper also builds the transcripts of active sessions that the user has not opened.
 */
export const createAgentChatTranscriptCacheKeeper = (): AgentChatTranscriptCacheKeeper => {
  const cache = createTranscriptModelCache();
  const shown = new Map<string, number>();
  let following: Following | null = null;

  const show = (sessionKey: string): (() => void) => {
    shown.set(sessionKey, (shown.get(sessionKey) ?? 0) + 1);
    following?.stopBuilds(sessionKey);
    return () => {
      const count = (shown.get(sessionKey) ?? 1) - 1;
      if (count > 0) shown.set(sessionKey, count);
      else shown.delete(sessionKey);
      following?.schedule();
    };
  };

  const follow: AgentChatTranscriptCacheKeeper["follow"] = ({ sessionStore, prepare }) => {
    const builds = new Map<string, KeeperBuild>();
    // An active session builds once, so an evicted transcript does not build again in a loop.
    const prepared = new Set<string>();
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let stopped = false;

    const schedule = (): void => {
      if (stopped || timer !== null) return;
      timer = globalThis.setTimeout(run, TRANSCRIPT_KEEP_DELAY_MS);
    };
    const stopBuild = (cacheKey: string): void => {
      builds.get(cacheKey)?.stop();
      builds.delete(cacheKey);
    };
    // A prepared transcript takes the place of the oldest cached one that no chat shows and whose
    // session is not active, so it never pushes out the rows that a reader sees or will open next.
    const findReplaceable = (): string | null => {
      for (const [cacheKey, entry] of cache) {
        const source = sessionStore.getSessionSource(entry.session);
        if (shown.has(agentSessionIdentityKey(entry.session))) continue;
        if (source && isActiveRootSession(source.session)) continue;
        return cacheKey;
      }
      return null;
    };
    const hasRoom = (): boolean =>
      cache.size < MAX_CACHED_TRANSCRIPTS || findReplaceable() !== null;
    const makeRoom = (): boolean => {
      if (cache.size < MAX_CACHED_TRANSCRIPTS) return true;
      const replaceable = findReplaceable();
      if (replaceable === null) return false;
      stopBuild(replaceable);
      cache.delete(replaceable);
      return true;
    };

    const buildInChunks = ({
      session,
      showThinkingMessages,
      previous,
      baseline,
      lifetime,
      prepares,
    }: {
      session: AgentChatTranscriptSession;
      showThinkingMessages: boolean;
      previous: TranscriptModelCacheEntry | null;
      baseline: Messages;
      lifetime: symbol;
      prepares: boolean;
    }): void => {
      const cacheKey = transcriptModelCacheKey(
        agentSessionIdentityKey(session),
        showThinkingMessages,
      );
      const build: KeeperBuild = { baseline, prepares, stop: () => {} };
      builds.set(cacheKey, build);
      build.stop = buildTranscriptModelInChunks({
        session,
        showThinkingMessages,
        previous,
        onComplete: (transcriptModel) => {
          builds.delete(cacheKey);
          if (
            sessionStore.getSessionSource(session)?.lifetime === lifetime &&
            (!prepares || makeRoom())
          ) {
            writeTranscriptModelCacheEntry({
              session,
              showThinkingMessages,
              transcriptModel,
              cache,
              touch: prepares,
              baseline,
              lifetime,
            });
            if (prepares) prepared.add(cacheKey);
          }
          schedule();
        },
      });
    };

    // A removed session or a replaced workspace collection drops its rows at once, and a build
    // stops when its rows leave the cache.
    const dropStaleWork = (): void => {
      for (const [cacheKey, entry] of cache) {
        if (
          entry.lifetime !== null &&
          entry.lifetime !== sessionStore.getSessionSource(entry.session)?.lifetime
        ) {
          stopBuild(cacheKey);
          cache.delete(cacheKey);
        }
      }
      for (const [cacheKey, build] of builds) {
        if (!build.prepares && !cache.has(cacheKey)) stopBuild(cacheKey);
      }
    };

    const keepCurrent = (cacheKey: string, entry: TranscriptModelCacheEntry): void => {
      const source = sessionStore.getSessionSource(entry.session);
      // Queried history has no live baseline, and a mounted transcript builds its own rows.
      if (!source || entry.baseline === null || shown.has(agentSessionIdentityKey(entry.session))) {
        stopBuild(cacheKey);
        return;
      }
      const live = source.session;
      if (isSameRevision(live.externalSessionId, entry.baseline, live.messages)) {
        stopBuild(cacheKey);
        return;
      }
      const build = builds.get(cacheKey);
      if (build && isSameRevision(live.externalSessionId, build.baseline, live.messages)) return;
      stopBuild(cacheKey);
      const session = toTranscriptSession(live, entry.session.skillReferences);
      const write = (transcriptModel: AgentChatTranscriptModel): void =>
        writeTranscriptModelCacheEntry({
          session,
          showThinkingMessages: entry.showThinkingMessages,
          transcriptModel,
          cache,
          touch: false,
          baseline: live.messages,
          lifetime: source.lifetime,
        });
      if (areSessionMessagesSameRevision(entry.session, session)) {
        write(entry);
        return;
      }
      const model = updateTranscriptModelAtOnce({
        session,
        showThinkingMessages: entry.showThinkingMessages,
        previous: entry,
      });
      if (model) {
        write(model);
        return;
      }
      // One full build at a time. Its completion starts the next one.
      if (builds.size > 0) return;
      buildInChunks({
        session,
        showThinkingMessages: entry.showThinkingMessages,
        previous: entry,
        baseline: live.messages,
        lifetime: source.lifetime,
        prepares: false,
      });
    };

    const prepareActive = ({ showThinkingMessages, repoPaths }: PreparedActiveTranscripts) => {
      const sessions = repoPaths.flatMap(
        (repoPath) => sessionStore.getWorkspaceStore(repoPath)?.listSessionSnapshots() ?? [],
      );
      const active = listActiveRootSessions(sessions).slice(0, MAX_CACHED_TRANSCRIPTS);
      const activeKeys = new Set(
        active.map((session) =>
          transcriptModelCacheKey(agentSessionIdentityKey(session), showThinkingMessages),
        ),
      );
      for (const cacheKey of prepared) {
        if (!activeKeys.has(cacheKey)) prepared.delete(cacheKey);
      }
      for (const session of active) {
        const sessionKey = agentSessionIdentityKey(session);
        const cacheKey = transcriptModelCacheKey(sessionKey, showThinkingMessages);
        const source = sessionStore.getSessionSource(session);
        if (
          !source ||
          session.historyLoadState !== "loaded" ||
          getSessionMessageCount(session) === 0 ||
          cache.has(cacheKey) ||
          prepared.has(cacheKey) ||
          builds.has(cacheKey) ||
          shown.has(sessionKey)
        ) {
          continue;
        }
        if (builds.size > 0 || !hasRoom()) return;
        buildInChunks({
          session: toAgentChatTranscriptSession(session),
          showThinkingMessages,
          previous: null,
          baseline: session.messages,
          lifetime: source.lifetime,
          prepares: true,
        });
        return;
      }
    };

    const run = (): void => {
      timer = null;
      dropStaleWork();
      for (const [cacheKey, entry] of cache) keepCurrent(cacheKey, entry);
      if (prepare) prepareActive(prepare);
    };

    const current: Following = {
      schedule,
      stopBuilds: (sessionKey) => {
        stopBuild(transcriptModelCacheKey(sessionKey, true));
        stopBuild(transcriptModelCacheKey(sessionKey, false));
      },
    };
    following = current;
    const unsubscribe = sessionStore.subscribe(() => {
      dropStaleWork();
      schedule();
    });
    dropStaleWork();
    schedule();
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== null) globalThis.clearTimeout(timer);
      for (const build of builds.values()) build.stop();
      builds.clear();
      if (following === current) following = null;
    };
  };

  return { cache, show, follow };
};
