import { describe, expect, test } from "bun:test";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import { createToolCallSources, findToolCall, type ToolCallSource } from "./tool-call-sources";
import type { TranscriptRowsContextValue } from "./transcript-rows-context";

const toolRow = (id: string, status: "running" | "completed"): AgentChatTranscriptRow => ({
  kind: "message",
  key: `row:${id}`,
  message: buildMessage("tool", "", {
    id,
    meta: {
      kind: "tool",
      partId: `${id}-part`,
      callId: `${id}-call`,
      tool: "bash",
      toolType: "bash",
      status,
      input: { command: "bun test" },
    },
  }),
});

const source = (rows: AgentChatTranscriptRow[]): ToolCallSource => ({
  // SAFETY: the store passes the context through and never reads it, so these tests leave it empty.
  context: {} as TranscriptRowsContextValue,
  rows,
});

describe("findToolCall", () => {
  test("finds the live call of a message, and nothing for a message that is not a call", () => {
    const answer: AgentChatTranscriptRow = {
      kind: "message",
      key: "row:answer",
      message: buildMessage("assistant", "Done.", { id: "answer" }),
    };
    const rows = [toolRow("call", "running"), answer];

    expect(findToolCall(rows, "call")?.meta.status).toBe("running");
    expect(findToolCall(rows, "answer")).toBeNull();
    expect(findToolCall(rows, "missing")).toBeNull();
  });
});

describe("createToolCallSources", () => {
  test("tells the readers of a session about each new transcript of it", () => {
    const sources = createToolCallSources();
    let calls = 0;
    const unsubscribe = sources.subscribe("session", () => {
      calls += 1;
    });
    const first = source([toolRow("call", "running")]);
    const next = source([toolRow("call", "completed")]);

    sources.publish("session", first);
    sources.publish("other", next);
    sources.publish("session", next);

    expect(calls).toBe(2);
    expect(findToolCall(sources.get("session")?.rows ?? [], "call")?.meta.status).toBe("completed");
    unsubscribe();
    sources.publish("session", first);
    expect(calls).toBe(2);
  });

  test("keeps the transcript of a session that another screen published after this one", () => {
    const sources = createToolCallSources();
    const closing = source([]);
    const open = source([toolRow("call", "running")]);

    sources.publish("session", closing);
    sources.publish("session", open);
    sources.remove("session", closing);
    expect(sources.get("session")).toBe(open);

    sources.remove("session", open);
    expect(sources.get("session")).toBeUndefined();
  });
});
