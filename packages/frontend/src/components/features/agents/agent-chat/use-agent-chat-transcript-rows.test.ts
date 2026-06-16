import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatThreadSession } from "./agent-chat.types";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import { useAgentChatTranscriptRows } from "./use-agent-chat-transcript-rows";

type HarnessProps = {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
};

type HookResult = ReturnType<typeof useAgentChatTranscriptRows>;

const mountHarness = async (props: HarnessProps) => {
  const harness = createHookHarness(
    (nextProps: HarnessProps): HookResult => useAgentChatTranscriptRows(nextProps),
    props,
  );

  await harness.mount();
  return harness;
};

const createLargeSession = (
  externalSessionId: string,
  messageCount = 160,
): AgentChatThreadSession => {
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

describe("useAgentChatTranscriptRows", () => {
  test("builds transcript rows immediately for large sessions", async () => {
    const session = createLargeSession("session-large");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows.length).toBeGreaterThan(0);
    await harness.unmount();
  });

  test("switches rows when the selected session changes", async () => {
    const firstSession = createLargeSession("session-a");
    const secondSession = createLargeSession("session-b");
    const harness = await mountHarness({
      session: firstSession,
      showThinkingMessages: true,
    });

    await harness.update({
      session: secondSession,
      showThinkingMessages: true,
    });

    const rowKeys = harness.getLatest().transcriptState.rows.map((row) => row.key);
    const secondSessionKey = agentSessionIdentityKey(secondSession);
    expect(rowKeys.length).toBeGreaterThan(0);
    expect(rowKeys.every((key) => key.startsWith(`${secondSessionKey}:`))).toBe(true);
    await harness.unmount();
  });

  test("updates rows when the session receives a new message state", async () => {
    const session = buildSession({
      externalSessionId: "session-state-replacement",
      messages: createSessionMessagesState("session-state-replacement", [
        buildMessage("assistant", "Before", { id: "assistant-1" }),
      ]),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });

    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-state-replacement",
          [buildMessage("assistant", "After", { id: "assistant-1" })],
          session.messages.version + 1,
        ),
      }),
      showThinkingMessages: true,
    });

    const messageRow = harness
      .getLatest()
      .transcriptState.rows.find((row) => row.kind === "message");
    expect(messageRow?.kind === "message" ? messageRow.message.content : null).toBe("After");
    await harness.unmount();
  });

  test("clears rows when no session is selected", async () => {
    const harness = await mountHarness({
      session: createLargeSession("session-clear"),
      showThinkingMessages: true,
    });

    await harness.update({
      session: null,
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows).toEqual([]);
    await harness.unmount();
  });
});
