import { describe, expect, test } from "bun:test";
import { AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX } from "@openducktor/core";
import { createSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import {
  type AgentChatTranscriptRow,
  buildAgentChatTranscriptModel,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  buildMessage,
  buildSession,
} from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import { SYSTEM_PROMPT_PREFIX } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  initialTranscriptFollowState,
  isAtTranscriptBottom,
  isNearTranscriptTop,
  reduceTranscriptFollow,
  transcriptContentKey,
} from "./transcript-follow";
import { nextUserMessageIndex, previousUserMessageIndex } from "./transcript-navigation";
import {
  foldsSystemText,
  messageRowKind,
  mobileTranscriptRows,
  type PresentToolCall,
} from "./transcript-row-type";
import { MAX_DISPLAY_CHARACTERS, truncateForDisplay } from "./transcript-text";

const presentToolCall: PresentToolCall = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: null,
}).presentToolCall;

const user = (id: string, content: string): AgentChatMessage =>
  buildMessage("user", content, { id, meta: { kind: "user", state: "read" } });
const assistant = (id: string, content: string): AgentChatMessage =>
  buildMessage("assistant", content, { id, meta: { kind: "assistant", isFinal: true } });
const reasoning = (id: string, content: string): AgentChatMessage =>
  buildMessage("thinking", content, {
    id,
    meta: { kind: "reasoning", partId: `${id}-part`, completed: true },
  });

const sessionWith = (messages: AgentChatMessage[]) => {
  const session = buildSession();
  return {
    ...session,
    messages: createSessionMessagesState(session.externalSessionId, messages),
  };
};

// The kinds that the transcript row dispatch renders.
const rowTypes = (rows: readonly AgentChatTranscriptRow[]) =>
  rows.map((row) =>
    row.kind === "message" ? messageRowKind(row.message, presentToolCall).kind : row.kind,
  );

describe("transcript rows", () => {
  const messages = [
    user("u1", "Explain the build"),
    reasoning("r1", "I should read the config first."),
    assistant("a1", "The build runs Vite."),
  ];

  test("show no Reasoning Messages while Show reasoning is off", () => {
    const model = buildAgentChatTranscriptModel(sessionWith(messages), {
      showThinkingMessages: false,
    });
    expect(rowTypes(model.rows)).toEqual(["user", "assistant"]);
  });

  test("show Reasoning Messages in place while Show reasoning is on", () => {
    const model = buildAgentChatTranscriptModel(sessionWith(messages), {
      showThinkingMessages: true,
    });
    expect(rowTypes(model.rows)).toEqual(["user", "reasoning", "assistant"]);
  });

  test("dispatch each message kind to its own row", () => {
    const tool = buildMessage("tool", "", {
      id: "t1",
      meta: {
        kind: "tool",
        partId: "t1-part",
        callId: "call-1",
        tool: "bash",
        toolType: "bash",
        status: "completed",
      },
    });
    const notice = buildMessage("system", "The user stopped the turn.", {
      id: "n1",
      meta: { kind: "session_notice", tone: "cancelled", reason: "user_stopped", title: "Stopped" },
    });
    const subagent = buildMessage("assistant", "", {
      id: "s1",
      meta: { kind: "subagent", partId: "s1-part", correlationKey: "c1", status: "running" },
    });
    const model = buildAgentChatTranscriptModel(
      sessionWith([user("u1", "Run it"), tool, subagent, notice]),
      { showThinkingMessages: false },
    );
    expect(rowTypes(model.rows)).toEqual(["user", "tool", "subagent", "notice"]);
  });

  test("dispatch artifact tools and retired workflow tools to workflow cards", () => {
    const toolMessage = (tool: string): AgentChatMessage =>
      buildMessage("tool", "", {
        id: tool,
        meta: {
          kind: "tool",
          partId: `${tool}-part`,
          callId: tool,
          tool,
          toolType: "workflow",
          status: "completed",
        },
      });
    const rowKind = (tool: string) => {
      const row = messageRowKind(toolMessage(tool), presentToolCall);
      if (!("meta" in row)) throw new Error("Expected a tool row.");
      const { meta: _meta, ...presentation } = row;
      return presentation;
    };

    expect(rowKind("odt_set_task_artifact")).toEqual({
      kind: "artifact_tool",
      displayName: "Set Artifact",
      operation: "set",
    });
    expect(rowKind("odt_delete_task_artifact")).toEqual({
      kind: "artifact_tool",
      displayName: "Delete Artifact",
      operation: "delete",
    });
    // A session from before artifacts keeps its retired tool calls.
    expect(rowKind("odt_set_spec")).toEqual({ kind: "workflow_tool", displayName: "set_spec" });
  });

  test("resolve the tool presentation of a message once, however often the list asks", () => {
    const tool = buildMessage("tool", "", {
      id: "t1",
      meta: {
        kind: "tool",
        partId: "t1-part",
        callId: "call-1",
        tool: "bash",
        toolType: "bash",
        status: "completed",
      },
    });
    let presentations = 0;
    const countingPresentToolCall: PresentToolCall = (toolName, displayLabel) => {
      presentations += 1;
      return presentToolCall(toolName, displayLabel);
    };
    // FlashList reads the type of each unmeasured row on every layout pass.
    for (let pass = 0; pass < 3; pass += 1) messageRowKind(tool, countingPresentToolCall);
    expect(presentations).toBe(1);
    // A changed message is a new object, so it resolves again.
    messageRowKind({ ...tool }, countingPresentToolCall);
    expect(presentations).toBe(2);
  });

  test("leave out the system prompt and keep instruction updates", () => {
    const prompt = buildMessage("system", `${SYSTEM_PROMPT_PREFIX}\nYou are the Builder.`, {
      id: "p1",
    });
    const update = buildMessage("system", "The workspace has new instructions.", { id: "i1" });
    const model = buildAgentChatTranscriptModel(
      sessionWith([prompt, user("u1", "Build it"), update]),
      { showThinkingMessages: false },
    );
    const rows = mobileTranscriptRows(model.rows);
    expect(rows.map((row) => row.key)).not.toContain(model.rows[0]?.key);
    expect(rowTypes(rows)).toEqual(["user", "system"]);
  });

  test("fold other OpenCode system text, as on desktop", () => {
    const reminder = buildMessage(
      "system",
      "<system-reminder>Plan mode is active.</system-reminder>",
      {
        id: "r1",
      },
    );
    const update = buildMessage("system", `${AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX}New rules.`, {
      id: "i1",
    });
    expect(foldsSystemText(reminder, "opencode")).toBe(true);
    expect(foldsSystemText(reminder, "codex")).toBe(false);
    expect(foldsSystemText(update, "opencode")).toBe(false);
    expect(foldsSystemText(user("u1", "Build it"), "opencode")).toBe(false);
  });

  test("keep the same rows when there is no system prompt", () => {
    const model = buildAgentChatTranscriptModel(sessionWith(messages), {
      showThinkingMessages: false,
    });
    expect(mobileTranscriptRows(model.rows)).toBe(model.rows);
  });
});

describe("transcript follow", () => {
  test("keeps the same state for new content while the reader is at the bottom", () => {
    const start = initialTranscriptFollowState("a");
    const next = reduceTranscriptFollow(start, { type: "content_changed", contentKey: "b" });
    // The same object, so a streamed change does not render the list again.
    expect(next).toBe(start);
    expect(next.hasNewActivity).toBe(false);
  });

  test("raises new activity when content arrives while the reader is scrolled up", () => {
    const scrolledUp = reduceTranscriptFollow(initialTranscriptFollowState("a"), {
      type: "scrolled",
      distanceFromBottom: 900,
      distanceFromTop: 0,
      viewportHeight: 600,
    });
    expect(scrolledUp.atBottom).toBe(false);
    expect(scrolledUp.hasNewActivity).toBe(false);
    const changed = reduceTranscriptFollow(scrolledUp, {
      type: "content_changed",
      contentKey: "b",
    });
    expect(changed.hasNewActivity).toBe(true);
  });

  test("clears new activity when the reader returns to the bottom or jumps to the latest message", () => {
    const changed = reduceTranscriptFollow(
      reduceTranscriptFollow(initialTranscriptFollowState("a"), {
        type: "scrolled",
        distanceFromBottom: 900,
        distanceFromTop: 0,
        viewportHeight: 600,
      }),
      { type: "content_changed", contentKey: "b" },
    );
    const back = reduceTranscriptFollow(changed, {
      type: "scrolled",
      distanceFromBottom: 10,
      distanceFromTop: 0,
      viewportHeight: 600,
    });
    expect(back).toEqual({ atBottom: true, atTop: true, hasNewActivity: false, contentKey: "b" });
    expect(reduceTranscriptFollow(changed, { type: "jumped_to_latest" })).toEqual({
      atBottom: true,
      atTop: true,
      hasNewActivity: false,
      contentKey: "b",
    });
  });

  test("shows the top control while the reader is away from the first message", () => {
    const away = reduceTranscriptFollow(initialTranscriptFollowState("a"), {
      type: "scrolled",
      distanceFromBottom: 0,
      distanceFromTop: 2000,
      viewportHeight: 600,
    });
    expect(away).toEqual({ atBottom: true, atTop: false, hasNewActivity: false, contentKey: "a" });
    const top = reduceTranscriptFollow(away, {
      type: "scrolled",
      distanceFromBottom: 2000,
      distanceFromTop: 40,
      viewportHeight: 600,
    });
    expect(top.atTop).toBe(true);
  });

  test("keeps the same state for more content while new activity already shows", () => {
    const changed = reduceTranscriptFollow(
      reduceTranscriptFollow(initialTranscriptFollowState("a"), {
        type: "scrolled",
        distanceFromBottom: 900,
        distanceFromTop: 0,
        viewportHeight: 600,
      }),
      { type: "content_changed", contentKey: "b" },
    );
    expect(changed.hasNewActivity).toBe(true);
    expect(reduceTranscriptFollow(changed, { type: "content_changed", contentKey: "c" })).toBe(
      changed,
    );
  });

  test("keeps the same state object when nothing changes", () => {
    const state = initialTranscriptFollowState("a");
    expect(reduceTranscriptFollow(state, { type: "content_changed", contentKey: "a" })).toBe(state);
    expect(
      reduceTranscriptFollow(state, {
        type: "scrolled",
        distanceFromBottom: 0,
        distanceFromTop: 0,
        viewportHeight: 600,
      }),
    ).toBe(state);
    expect(reduceTranscriptFollow(state, { type: "jumped_to_latest" })).toBe(state);
  });

  test("a jump to the first rows leaves the bottom and keeps new activity", () => {
    const away = reduceTranscriptFollow(
      reduceTranscriptFollow(initialTranscriptFollowState("a"), {
        type: "scrolled",
        distanceFromBottom: 900,
        distanceFromTop: 900,
        viewportHeight: 600,
      }),
      { type: "content_changed", contentKey: "b" },
    );
    const top = reduceTranscriptFollow(away, { type: "jumped_to_top" });
    expect(top).toEqual({ ...away, atTop: true, atBottom: false });
    expect(reduceTranscriptFollow(top, { type: "jumped_to_top" })).toBe(top);
  });

  test("a new list places the top from its content size", () => {
    const state = initialTranscriptFollowState("a");
    const tall = reduceTranscriptFollow(state, {
      type: "content_measured",
      distanceFromTop: 2000,
      viewportHeight: 600,
    });
    expect(tall).toEqual({ ...state, atTop: false });
    expect(
      reduceTranscriptFollow(tall, {
        type: "content_measured",
        distanceFromTop: 2400,
        viewportHeight: 600,
      }),
    ).toBe(tall);
  });

  test("treats the space under the latest message as the bottom, and a fifth as the top", () => {
    expect(isAtTranscriptBottom(15)).toBe(true);
    expect(isAtTranscriptBottom(16)).toBe(false);
    expect(isNearTranscriptTop(120, 600)).toBe(true);
    expect(isNearTranscriptTop(121, 600)).toBe(false);
  });

  test("names content by row count, last row, and message revision", () => {
    expect(transcriptContentKey({ rowCount: 2, lastRowKey: "x", messagesVersion: 3 })).not.toBe(
      transcriptContentKey({ rowCount: 2, lastRowKey: "x", messagesVersion: 4 }),
    );
  });
});

describe("user message navigation", () => {
  const model = buildAgentChatTranscriptModel(
    sessionWith([
      user("u1", "First"),
      assistant("a1", "One"),
      user("u2", "Second"),
      assistant("a2", "Two"),
      assistant("a3", "Three"),
      user("u3", "Third"),
    ]),
    { showThinkingMessages: false },
  );

  test("moves to the user message before the first row in view", () => {
    expect(previousUserMessageIndex(model.rows, 4)).toBe(2);
    expect(previousUserMessageIndex(model.rows, 2)).toBe(0);
    expect(previousUserMessageIndex(model.rows, 0)).toBeNull();
  });

  test("moves to the user message after the first row in view", () => {
    expect(nextUserMessageIndex(model.rows, 0)).toBe(2);
    expect(nextUserMessageIndex(model.rows, 3)).toBe(5);
    expect(nextUserMessageIndex(model.rows, 5)).toBeNull();
  });
});

describe("tool text display", () => {
  test("cuts long text and says how much it shows", () => {
    const shown = truncateForDisplay("x".repeat(MAX_DISPLAY_CHARACTERS + 5));
    expect(shown.truncated).toBe(true);
    expect(shown.text).toHaveLength(MAX_DISPLAY_CHARACTERS);
    expect(shown.notice).toContain("20,005");
    expect(truncateForDisplay("short")).toEqual({ text: "short", truncated: false, notice: "" });
  });
});
