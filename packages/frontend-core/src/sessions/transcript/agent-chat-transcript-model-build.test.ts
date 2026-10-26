import { describe, expect, test } from "bun:test";
import { buildMessage, buildSession } from "../../test-support/agent-chat-transcript-fixtures";
import type { AgentChatMessage } from "../../types/agent-orchestrator";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { updateTranscriptModelAtOnce } from "./agent-chat-transcript-model-build";
import {
  type AgentChatTranscriptModel,
  createAgentChatTranscriptModelBuilder,
} from "./agent-chat-transcript-model";
import type { TranscriptModelCacheEntry } from "./agent-chat-transcript-model-cache";

const SESSION_ID = "build-session";

const message = (role: AgentChatMessage["role"], id: string, content = id): AgentChatMessage =>
  role === "assistant"
    ? buildMessage(role, content, { id })
    : { id, role, content, timestamp: "2026-10-24T10:00:00.000Z" };

// The session fixture clones its messages, so the messages state keeps the objects here.
const transcript = (items: AgentChatMessage[], version: number): AgentChatTranscriptSession => ({
  ...buildSession({ externalSessionId: SESSION_ID }),
  messages: createSessionMessagesState(SESSION_ID, items, version),
});

const fullModel = (
  session: AgentChatTranscriptSession,
  showThinkingMessages: boolean,
): AgentChatTranscriptModel =>
  createAgentChatTranscriptModelBuilder(session, { showThinkingMessages }).complete();

const cached = (
  session: AgentChatTranscriptSession,
  showThinkingMessages: boolean,
): TranscriptModelCacheEntry => ({
  ...fullModel(session, showThinkingMessages),
  session,
  baseline: null,
  lifetime: null,
  showThinkingMessages,
});

// Rows keep their keys and message objects, so a view renders the same either way.
const renderedRows = (model: AgentChatTranscriptModel) => ({
  rows: model.rows.map((row) =>
    row.kind === "message"
      ? { key: row.key, message: row.message }
      : row.kind === "turn_duration"
        ? { key: row.key, durationMs: row.durationMs }
        : { key: row.key, label: row.label },
  ),
  turnAnchors: model.turnAnchors,
  userMessageAnchors: model.userMessageAnchors.map(({ rowKey, rowIndex }) => ({
    rowKey,
    rowIndex,
  })),
  lastUserMessageKey: model.lastUserMessageKey,
  hasAttachmentMessages: model.hasAttachmentMessages,
  activeStreamingAssistantMessageId: model.activeStreamingAssistantMessageId,
});

const base = [
  message("user", "user-1"),
  message("assistant", "assistant-1"),
  message("tool", "tool-1"),
  message("thinking", "thinking-1"),
  message("assistant", "assistant-2"),
  message("tool", "tool-2"),
];

const replaceAt = (items: AgentChatMessage[], index: number): AgentChatMessage[] =>
  items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, content: `${item.content} changed` } : item,
  );

describe("updateTranscriptModelAtOnce", () => {
  test.each([
    ["a tool call at the end changes", replaceAt(base, 5)],
    [
      "a tool call changes and text follows it",
      [...replaceAt(base, 2), message("assistant", "new")],
    ],
    [
      "a user message changes and the answer starts",
      [...replaceAt(base, 0), message("assistant", "answer")],
    ],
    ["shown thinking changes", replaceAt(base, 3)],
    ["messages arrive", [...base, message("user", "user-2"), message("assistant", "assistant-3")]],
  ])("matches a full build when %s", (_label: string, nextItems: AgentChatMessage[]) => {
    for (const showThinkingMessages of [true, false]) {
      if (!showThinkingMessages && nextItems[3] !== base[3]) continue;
      const previous = cached(transcript(base, 1), showThinkingMessages);
      const next = transcript(nextItems, 2);
      const model = updateTranscriptModelAtOnce({ session: next, showThinkingMessages, previous });
      expect(model).not.toBeNull();
      expect(renderedRows(model!)).toEqual(renderedRows(fullModel(next, showThinkingMessages)));
    }
  });

  test.each([
    ["hidden thinking changes", replaceAt(base, 3), false],
    [
      "a changed message takes another id",
      base.map((item, index) => (index === 5 ? message("tool", "tool-3") : item)),
      true,
    ],
    [
      "more messages change than an update at once allows",
      [
        ...replaceAt(base, 0),
        ...Array.from({ length: 100 }, (_, index) => message("assistant", `extra-${index}`)),
      ],
      true,
    ],
  ])(
    "needs a full build when %s",
    (_label: string, nextItems: AgentChatMessage[], showThinkingMessages: boolean) => {
      const previous = cached(transcript(base, 1), showThinkingMessages);
      const next = transcript(nextItems, 2);
      expect(
        updateTranscriptModelAtOnce({ session: next, showThinkingMessages, previous }),
      ).toBeNull();
    },
  );

  test("needs a full build when the cut would lose the system prompt row", () => {
    // The system prompt row moves before the first user row, after the first assistant row.
    const items = [
      message("system", "history:system-prompt:1", "System prompt"),
      message("assistant", "assistant-1"),
      message("user", "user-1"),
    ];
    const previous = cached(transcript(items, 1), true);
    expect(
      previous.rows.map((row) => (row.kind === "message" ? row.message.id : row.kind)),
    ).toEqual(["turn_duration", "assistant-1", "history:system-prompt:1", "user-1"]);
    const next = transcript(replaceAt(items, 1), 2);

    expect(
      updateTranscriptModelAtOnce({ session: next, showThinkingMessages: true, previous }),
    ).toBeNull();
  });
});
