import { describe, expect, test } from "bun:test";
import { readLatestHistoryAssistantModel } from "./claude-agent-sdk-history-entry";
import { claudeHistoryMessagesFixture } from "./claude-agent-sdk-history-test-messages";

const reply = (
  uuid: string,
  model: string,
  effort: { effort?: string; perTurnEffort?: string },
  isSidechain = false,
) => ({
  type: "assistant",
  uuid,
  sessionId: "session-1",
  isSidechain,
  ...effort,
  message: { id: uuid, model, role: "assistant", content: [{ type: "text", text: "Done." }] },
});

const selection = (modelId: string, variant: string) => ({
  runtimeKind: "claude" as const,
  providerId: "claude",
  modelId,
  variant,
});

describe("readLatestHistoryAssistantModel", () => {
  test.each([
    {
      name: "keeps the latest root reply over a later subagent reply",
      replies: [
        reply("root", "claude-opus-5-5", { effort: "max" }),
        reply("subagent", "claude-haiku-5-5", { effort: "low" }, true),
      ],
      expected: selection("claude-opus-5-5", "max"),
    },
    {
      name: "skips a synthetic reply",
      replies: [
        reply("root", "claude-opus-5-5", { effort: "high" }),
        reply("synthetic", "<synthetic>", { effort: "low" }),
      ],
      expected: selection("claude-opus-5-5", "high"),
    },
    {
      name: "prefers the per-turn effort over the session effort",
      replies: [reply("root", "claude-opus-5-5", { effort: "high", perTurnEffort: "max" })],
      expected: selection("claude-opus-5-5", "max"),
    },
    { name: "returns null without a reply", replies: [], expected: null },
  ])("$name", ({ replies, expected }) => {
    expect(readLatestHistoryAssistantModel(claudeHistoryMessagesFixture(replies))).toEqual(
      expected,
    );
  });
});
