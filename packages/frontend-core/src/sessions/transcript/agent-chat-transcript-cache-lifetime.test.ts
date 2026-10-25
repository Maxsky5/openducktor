import "../../test-support/dom-environment";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { render } from "@testing-library/react";
import { Activity, act, createElement, useContext, useSyncExternalStore } from "react";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { AgentSessionsContext } from "../session-contexts";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import { createAnimationFrameTestDriver } from "../../test-support/animation-frame-test-driver";
import { installReactActEnvironment } from "../../test-support/react-act-environment";
import { createAgentSessionFixture } from "../../test-support/shared-test-fixtures";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { buildMessage, buildSession } from "../../test-support/agent-chat-transcript-fixtures";
import { AgentChatTranscriptCacheProvider } from "./agent-chat-transcript-cache-provider";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import type { TranscriptModelCache } from "./agent-chat-transcript-model-cache";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";
import { useAgentChatTranscriptModel } from "./use-agent-chat-transcript-model";

type HookResult = ReturnType<typeof useAgentChatTranscriptModel>;
const animationFrameDriver = createAnimationFrameTestDriver();

const createLargeSession = (
  externalSessionId: string,
  messageCount = 500,
): AgentChatTranscriptSession => {
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const turnIndex = Math.floor(index / 2);
    if (index % 2 === 0) {
      return buildMessage("user", `Question ${turnIndex}`, { id: `user-${turnIndex}` });
    }

    return buildMessage("assistant", `Answer ${turnIndex}`, { id: `assistant-${turnIndex}` });
  });

  return buildSession({
    externalSessionId,
    messages: createSessionMessagesState(externalSessionId, messages, 1),
  });
};

async function flushTranscriptDerivation(
  isDone: () => boolean,
  { timeoutMs }: { timeoutMs: number },
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await animationFrameDriver.flushFrames();
    await animationFrameDriver.flushTimers();
    if (isDone()) return;
  }
  throw new Error("Timed out waiting for transcript rows.");
}

/** Runs the chunked builds and the keeper passes that fake timers hold. */
const runTimers = async (): Promise<void> => {
  await act(async () => {
    jest.runAllTimers();
  });
};

describe("transcript cache lifetime", () => {
  let restoreActEnvironment = () => {};
  beforeEach(() => {
    restoreActEnvironment = installReactActEnvironment();
    animationFrameDriver.install();
  });
  afterEach(() => {
    animationFrameDriver.restore();
    restoreActEnvironment();
  });

  test("clears removed session rows after the chat unmounts", async () => {
    const first = createAgentSessionFixture({
      ...createLargeSession("released", 2),
      historyLoadState: "loaded",
    });
    const store = createAgentSessionsStore("/repo");
    store.replaceSession(first);
    let cache!: TranscriptModelCache;
    let transcript!: HookResult;
    const Chat = () => {
      const session = useSyncExternalStore(store.subscribe, () => store.getSessionSnapshot(first));
      transcript = useAgentChatTranscriptModel({
        session: session ? toAgentChatTranscriptSession(session) : null,
        showThinkingMessages: true,
      });
      return null;
    };
    const Cache = ({ showChat }: { showChat: boolean }) => {
      cache = useContext(AgentChatTranscriptCacheContext)!.cache;
      return showChat ? createElement(Chat) : null;
    };
    const view = (showChat: boolean) =>
      createElement(
        AgentSessionsContext.Provider,
        { value: store },
        createElement(AgentChatTranscriptCacheProvider, {
          children: createElement(Cache, { showChat }),
        }),
      );
    const rendered = render(view(true));
    try {
      expect(cache.size).toBe(1);
      act(() => {
        store.replaceSession({
          ...first,
          messages: createLargeSession(first.externalSessionId).messages,
        });
      });
      expect(transcript.isTranscriptModelPending).toBe(true);
      rendered.rerender(view(false));
      act(() => store.removeSession(first));
      expect(cache.size).toBe(0);
      await animationFrameDriver.flushTimers(5);
      expect(cache.size).toBe(0);
    } finally {
      rendered.unmount();
    }
  });

  // Builds and mounts large transcripts, which can exceed 1000 ms on a loaded CI runner.
  test("keeps large cached transcripts current across keyed chat mounts", async () => {
    const transcript = createLargeSession("keyed-large");
    const first = createAgentSessionFixture({ ...transcript, historyLoadState: "loaded" });
    const second = createAgentSessionFixture({ externalSessionId: "keyed-other" });
    const store = createAgentSessionsStore("/repo");
    store.replaceSession(first);
    store.replaceSession(second);
    const observed: HookResult[] = [];
    const Probe = ({ identity }: { identity: AgentChatTranscriptSession }) => {
      const live = useSyncExternalStore(store.subscribe, () => store.getSessionSnapshot(identity));
      observed.push(
        useAgentChatTranscriptModel({
          session: live ? toAgentChatTranscriptSession(live) : null,
          showThinkingMessages: true,
        }),
      );
      return null;
    };
    const view = (session: typeof first) =>
      createElement(
        AgentSessionsContext.Provider,
        { value: store },
        createElement(AgentChatTranscriptCacheProvider, {
          children: createElement(Probe, {
            key: session.externalSessionId,
            identity: toAgentChatTranscriptSession(session),
          }),
        }),
      );
    // The keeper gathers live changes for a delay, so fake timers run it at once.
    jest.useFakeTimers();
    const rendered = render(view(first));
    try {
      await runTimers();
      expect(observed.at(-1)?.hasCurrentRowsForActiveSession).toBe(true);
      const rows = observed.at(-1)?.transcriptState.rows;
      rendered.rerender(view(second));
      const beforeReturn = observed.length;
      rendered.rerender(view(first));
      expect(observed[beforeReturn]?.isTranscriptModelMissing).toBe(false);
      expect(observed[beforeReturn]?.transcriptState.rows).toBe(rows);

      rendered.rerender(view(second));
      act(() => {
        store.replaceSession({
          ...first,
          messages: createSessionMessagesState(
            first.externalSessionId,
            [
              buildMessage("user", "Changed while inactive", { id: "user-0" }),
              ...first.messages.items.slice(1),
            ],
            first.messages.version + 1,
          ),
        });
      });
      await runTimers();
      const beforeUpdateReturn = observed.length;
      rendered.rerender(view(first));
      expect(observed[beforeUpdateReturn]?.hasCurrentRowsForActiveSession).toBe(true);
      expect(observed[beforeUpdateReturn]?.transcriptState.rows[0]).toMatchObject({
        kind: "message",
        message: { content: "Changed while inactive" },
      });
    } finally {
      rendered.unmount();
      jest.useRealTimers();
    }
  }, 5_000);

  test("opens a chat on its latest messages when new messages came while it was closed", async () => {
    const first = createAgentSessionFixture({
      ...createLargeSession("reopened-large"),
      historyLoadState: "loaded",
    });
    const second = createAgentSessionFixture({ externalSessionId: "reopened-other" });
    const store = createAgentSessionsStore("/repo");
    store.replaceSession(first);
    store.replaceSession(second);
    const observed: HookResult[] = [];
    const Probe = ({ identity }: { identity: AgentChatTranscriptSession }) => {
      const live = useSyncExternalStore(store.subscribe, () => store.getSessionSnapshot(identity));
      observed.push(
        useAgentChatTranscriptModel({
          session: live ? toAgentChatTranscriptSession(live) : null,
          showThinkingMessages: true,
        }),
      );
      return null;
    };
    const view = (session: typeof first) =>
      createElement(
        AgentSessionsContext.Provider,
        { value: store },
        createElement(AgentChatTranscriptCacheProvider, {
          children: createElement(Probe, {
            key: session.externalSessionId,
            identity: toAgentChatTranscriptSession(session),
          }),
        }),
      );
    jest.useFakeTimers();
    const rendered = render(view(first));
    try {
      await runTimers();
      rendered.rerender(view(second));
      act(() => {
        store.replaceSession({
          ...first,
          messages: createSessionMessagesState(
            first.externalSessionId,
            [
              ...first.messages.items,
              buildMessage("assistant", "Came while closed", { id: "new" }),
            ],
            first.messages.version + 1,
          ),
        });
      });

      // The keeper has not run yet, so the open chat applies the change on its first render.
      const beforeReturn = observed.length;
      rendered.rerender(view(first));
      expect(observed[beforeReturn]?.hasCurrentRowsForActiveSession).toBe(true);
      expect(observed[beforeReturn]?.transcriptState.rows.at(-1)).toMatchObject({
        kind: "message",
        message: { content: "Came while closed" },
      });
    } finally {
      rendered.unmount();
      jest.useRealTimers();
    }
  });

  // Builds and mounts large transcripts, which can exceed 1000 ms on a loaded CI runner.
  test("does not show a stale transcript when a hidden chat returns before its build finishes", async () => {
    const first = createLargeSession("hidden-large");
    const observed: HookResult[] = [];
    const Probe = ({ session }: { session: AgentChatTranscriptSession }) => {
      observed.push(useAgentChatTranscriptModel({ session, showThinkingMessages: true }));
      return null;
    };
    const view = (mode: "visible" | "hidden", session = first) =>
      createElement(AgentChatTranscriptCacheProvider, {
        children: createElement(Activity, { mode, children: createElement(Probe, { session }) }),
      });
    const rendered = render(view("visible"));
    try {
      await flushTranscriptDerivation(
        () => Boolean(observed.at(-1)?.hasCurrentRowsForActiveSession),
        { timeoutMs: 1_000 },
      );
      rendered.rerender(view("hidden"));
      const updated = {
        ...first,
        messages: createSessionMessagesState(
          first.externalSessionId,
          [
            buildMessage("user", "Changed while hidden", { id: "user-0" }),
            ...first.messages.items.slice(1),
          ],
          first.messages.version + 1,
        ),
      };
      rendered.rerender(view("hidden", updated));
      const beforeReturn = observed.length;
      rendered.rerender(view("visible", updated));
      expect(observed[beforeReturn]?.isTranscriptModelMissing).toBe(true);
      expect(observed[beforeReturn]?.transcriptState.rows).toEqual([]);
      await flushTranscriptDerivation(
        () => Boolean(observed.at(-1)?.hasCurrentRowsForActiveSession),
        { timeoutMs: 1_000 },
      );
      expect(observed.at(-1)?.transcriptState.rows[0]).toMatchObject({
        kind: "message",
        message: { content: "Changed while hidden" },
      });
    } finally {
      rendered.unmount();
    }
  }, 5_000);
});
