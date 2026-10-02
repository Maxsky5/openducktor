import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { Activity, act, createElement, useSyncExternalStore } from "react";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext } from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { installReactActEnvironment } from "@/test-utils/react-act-environment";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import { AgentChatTranscriptCacheProvider } from "./agent-chat-transcript-cache-provider";
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
    const rendered = render(view(first));
    try {
      await flushTranscriptDerivation(
        () => Boolean(observed.at(-1)?.hasCurrentRowsForActiveSession),
        {
          timeoutMs: 1_000,
        },
      );
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
      await animationFrameDriver.flushTimers(20);
      const beforeUpdateReturn = observed.length;
      rendered.rerender(view(first));
      expect(observed[beforeUpdateReturn]?.hasCurrentRowsForActiveSession).toBe(true);
      expect(observed[beforeUpdateReturn]?.transcriptState.rows[0]).toMatchObject({
        kind: "message",
        message: { content: "Changed while inactive" },
      });
    } finally {
      rendered.unmount();
    }
  });

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
  });
});
