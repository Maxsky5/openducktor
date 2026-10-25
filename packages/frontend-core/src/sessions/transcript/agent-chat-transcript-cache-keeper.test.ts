import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { buildMessage } from "../../test-support/agent-chat-transcript-fixtures";
import { createAgentSessionFixture } from "../../test-support/shared-test-fixtures";
import type { AgentSessionState } from "../../types/agent-orchestrator";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import { createAgentSessionsStore } from "../agent-sessions-store";
import {
  createAgentChatTranscriptCacheKeeper,
  TRANSCRIPT_KEEP_DELAY_MS,
} from "./agent-chat-transcript-cache-keeper";
import { createAgentChatTranscriptModelBuilder } from "./agent-chat-transcript-model";
import {
  transcriptModelCacheKey,
  writeTranscriptModelCacheEntry,
} from "./agent-chat-transcript-model-cache";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";

const REPO = "/repo";

const withMessages = (
  externalSessionId: string,
  count: number,
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId,
    status: "idle",
    historyLoadState: "loaded",
    messages: createSessionMessagesState(
      externalSessionId,
      Array.from({ length: count }, (_, index) =>
        buildMessage(index % 2 === 0 ? "user" : "assistant", `Message ${index + 1}`, {
          id: `${externalSessionId}-${index + 1}`,
        }),
      ),
      count,
    ),
    ...overrides,
  });

/** The same session with more messages. The store keeps the objects of the earlier ones. */
const withMoreMessages = (session: AgentSessionState, count: number): AgentSessionState => {
  const items = [...session.messages.items];
  for (let index = items.length; index < count; index += 1) {
    items.push(
      buildMessage(index % 2 === 0 ? "user" : "assistant", `Message ${index + 1}`, {
        id: `${session.externalSessionId}-${index + 1}`,
      }),
    );
  }
  return {
    ...session,
    messages: createSessionMessagesState(session.externalSessionId, items, count),
  };
};

const cacheKeyOf = (session: AgentSessionState): string =>
  transcriptModelCacheKey(agentSessionIdentityKey(session), true);

const setup = (sessions: AgentSessionState[]) => {
  const store = createAgentSessionsStore(REPO);
  for (const session of sessions) store.replaceSession(session);
  const keeper = createAgentChatTranscriptCacheKeeper();
  // The rows that a chat leaves in the cache when it closes.
  const cacheAsOpened = (session: AgentSessionState): void => {
    const transcriptSession = toAgentChatTranscriptSession(session);
    writeTranscriptModelCacheEntry({
      session: transcriptSession,
      showThinkingMessages: true,
      transcriptModel: createAgentChatTranscriptModelBuilder(transcriptSession, {
        showThinkingMessages: true,
      }).complete(),
      cache: keeper.cache,
      baseline: session.messages,
      lifetime: store.getSessionSource(session)?.lifetime ?? null,
    });
  };
  const cachedContents = (session: AgentSessionState): string[] =>
    (keeper.cache.get(cacheKeyOf(session))?.rows ?? []).flatMap((row) =>
      row.kind === "message" ? [row.message.content] : [],
    );
  return { store, keeper, cacheAsOpened, cachedContents };
};

describe("createAgentChatTranscriptCacheKeeper", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("updates a transcript out of view once after its live changes collect", () => {
    const session = withMessages("idle", 2);
    const { store, keeper, cacheAsOpened, cachedContents } = setup([session]);
    cacheAsOpened(session);
    const stop = keeper.follow({ sessionStore: store, prepare: null });

    const three = withMoreMessages(session, 3);
    store.replaceSession(three);
    store.replaceSession(withMoreMessages(three, 4));
    jest.advanceTimersByTime(TRANSCRIPT_KEEP_DELAY_MS - 1);
    expect(cachedContents(session)).toEqual(["Message 1", "Message 2"]);

    jest.advanceTimersByTime(1);
    expect(cachedContents(session)).toEqual(["Message 1", "Message 2", "Message 3", "Message 4"]);
    stop();
  });

  test("leaves the transcript that a chat shows and updates it after the chat closes", () => {
    const session = withMessages("shown", 2);
    const { store, keeper, cacheAsOpened, cachedContents } = setup([session]);
    cacheAsOpened(session);
    const stop = keeper.follow({ sessionStore: store, prepare: null });
    const hide = keeper.show(agentSessionIdentityKey(session));

    store.replaceSession(withMoreMessages(session, 3));
    jest.runAllTimers();
    expect(cachedContents(session)).toEqual(["Message 1", "Message 2"]);

    hide();
    jest.runAllTimers();
    expect(cachedContents(session)).toEqual(["Message 1", "Message 2", "Message 3"]);
    stop();
  });

  test("rebuilds a transcript out of view when a change does not update at once", () => {
    const session = withMessages("reloaded", 3);
    const { store, keeper, cacheAsOpened, cachedContents } = setup([session]);
    cacheAsOpened(session);
    const stop = keeper.follow({ sessionStore: store, prepare: null });

    store.replaceSession({
      ...session,
      messages: createSessionMessagesState(
        session.externalSessionId,
        [
          buildMessage("user", "Read again", { id: "reloaded-1" }),
          ...session.messages.items.slice(1),
        ],
        session.messages.version + 1,
      ),
    });
    jest.runAllTimers();
    expect(cachedContents(session)).toEqual(["Read again", "Message 2", "Message 3"]);
    stop();
  });

  test("stops a build out of view when its rows leave the cache", () => {
    const session = withMessages("evicted", 2);
    const { store, keeper, cacheAsOpened } = setup([session]);
    cacheAsOpened(session);
    const stop = keeper.follow({ sessionStore: store, prepare: null });
    let reads = 0;
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      ...buildMessage("assistant", `New answer ${index}`),
      get id() {
        reads += 1;
        return `new-answer-${index}`;
      },
    }));
    store.replaceSession({
      ...session,
      messages: createSessionMessagesState(session.externalSessionId, items, 3),
    });
    // The pass starts a full build in slices. The first slice reads part of the messages.
    jest.advanceTimersByTime(TRANSCRIPT_KEEP_DELAY_MS);
    const afterStart = reads;

    keeper.cache.delete(cacheKeyOf(session));
    store.replaceSession(withMessages("other", 1));
    jest.runAllTimers();
    expect(reads).toBe(afterStart);
    stop();
  });

  test("builds the transcripts of active sessions before the user opens them", () => {
    const working = withMessages("working", 3, { status: "running" });
    const idle = withMessages("idle", 3);
    const unread = withMessages("unread", 3, {
      status: "running",
      historyLoadState: "not_requested",
    });
    const { store, keeper, cachedContents } = setup([working, idle, unread]);
    const stop = keeper.follow({
      sessionStore: store,
      prepare: { showThinkingMessages: true, repoPaths: [REPO] },
    });

    jest.runAllTimers();
    expect([...keeper.cache.keys()]).toEqual([cacheKeyOf(working)]);
    expect(cachedContents(working)).toEqual(["Message 1", "Message 2", "Message 3"]);

    // An evicted transcript waits for the user, instead of a loop of builds.
    keeper.cache.delete(cacheKeyOf(working));
    store.replaceSession(withMoreMessages(working, 4));
    jest.runAllTimers();
    expect(keeper.cache.has(cacheKeyOf(working))).toBe(false);
    stop();
  });

  test("never replaces the rows that a chat shows or of an active session to prepare one", () => {
    const shownSession = withMessages("shown", 2);
    const activeSession = withMessages("active", 2, { status: "running" });
    const idle = ["idle-1", "idle-2", "idle-3", "idle-4"].map((id) => withMessages(id, 2));
    const next = withMessages("next", 2, { status: "running" });
    const { store, keeper, cacheAsOpened } = setup([shownSession, activeSession, ...idle, next]);
    for (const session of [shownSession, activeSession, ...idle]) cacheAsOpened(session);
    const hide = keeper.show(agentSessionIdentityKey(shownSession));
    const stop = keeper.follow({
      sessionStore: store,
      prepare: { showThinkingMessages: true, repoPaths: [REPO] },
    });

    jest.runAllTimers();
    expect([...keeper.cache.keys()]).toEqual(
      [shownSession, activeSession, ...idle.slice(1), next].map(cacheKeyOf),
    );
    hide();
    stop();
  });

  test("drops the rows of a removed session at once", () => {
    const session = withMessages("removed", 2);
    const { store, keeper, cacheAsOpened } = setup([session]);
    cacheAsOpened(session);
    const stop = keeper.follow({ sessionStore: store, prepare: null });

    store.removeSession(session);
    expect(keeper.cache.size).toBe(0);
    stop();
  });
});
