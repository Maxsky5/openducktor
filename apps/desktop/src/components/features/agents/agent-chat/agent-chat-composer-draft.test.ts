import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  createSlashCommandSegment,
  createTextSegment,
  readSlashTriggerMatchForDraft,
} from "./agent-chat-composer-draft";

const COMMAND = {
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: ["compact"],
};

describe("applyComposerDraftEdit", () => {
  test("inserts a newline into a text segment and returns a focus target", () => {
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("hello world", "text-1")],
    };

    const result = applyComposerDraftEdit(draft, {
      type: "insert_newline",
      segmentId: "text-1",
      caretOffset: 5,
    });

    expect(result).toEqual({
      draft: {
        segments: [expect.objectContaining({ id: "text-1", kind: "text", text: "hello\n world" })],
      },
      focusTarget: {
        segmentId: "text-1",
        offset: 6,
      },
    });
  });

  test("removes a slash command and merges adjacent text segments", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("before ", "text-before"),
        createSlashCommandSegment(COMMAND, "slash-1"),
        createTextSegment(" after", "text-after"),
      ],
    };

    const result = applyComposerDraftEdit(draft, {
      type: "remove_slash_command",
      segmentId: "slash-1",
    });

    expect(result).toEqual({
      draft: {
        segments: [
          expect.objectContaining({ id: "text-before", kind: "text", text: "before  after" }),
        ],
      },
      focusTarget: {
        segmentId: "text-before",
        offset: 7,
      },
    });
  });

  test("only exposes slash autocomplete at the beginning of the draft", () => {
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("hello /compact", "text-1")],
    };

    expect(readSlashTriggerMatchForDraft(draft, "text-1", 14)).toBeNull();
  });

  test("does not expose slash autocomplete when a slash command chip already exists", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-1"),
        createSlashCommandSegment(COMMAND, "slash-1"),
        createTextSegment("/compact", "text-2"),
      ],
    };

    expect(readSlashTriggerMatchForDraft(draft, "text-2", 8)).toBeNull();
  });
});
