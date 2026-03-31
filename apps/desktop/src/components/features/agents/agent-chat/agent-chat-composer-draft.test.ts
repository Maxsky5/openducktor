import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  createFileReferenceSegment,
  createSlashCommandSegment,
  createTextSegment,
  normalizeComposerDraft,
  readFileTriggerMatchForDraft,
  readSlashTriggerMatchForDraft,
} from "./agent-chat-composer-draft";

const COMMAND = {
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: ["compact"],
};

const FILE = {
  id: "src/main.ts",
  path: "src/main.ts",
  name: "main.ts",
  kind: "ts" as const,
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

  test("does not expose slash autocomplete after a file reference chip", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-1"),
        createFileReferenceSegment(FILE, "file-1"),
        createTextSegment(" /compact", "text-2"),
      ],
    };

    expect(readSlashTriggerMatchForDraft(draft, "text-2", 9)).toBeNull();
  });

  test("does not insert a slash command after a file reference chip", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "text-1"),
        createFileReferenceSegment(FILE, "file-1"),
        createTextSegment("/compact", "text-2"),
      ],
    };

    const result = applyComposerDraftEdit(draft, {
      type: "insert_slash_command",
      textSegmentId: "text-2",
      rangeStart: 0,
      rangeEnd: 8,
      command: COMMAND,
    });

    expect(result).toBeNull();
  });

  test("replaces an @query range with a file reference chip", () => {
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("see @src/ma now", "text-1")],
    };

    const result = applyComposerDraftEdit(draft, {
      type: "insert_file_reference",
      textSegmentId: "text-1",
      rangeStart: 4,
      rangeEnd: 11,
      file: FILE,
    });

    expect(result).toEqual({
      draft: {
        segments: [
          expect.objectContaining({ id: "text-1", kind: "text", text: "see " }),
          expect.objectContaining({ kind: "file_reference", file: FILE }),
          expect.objectContaining({ kind: "text", text: " now" }),
        ],
      },
      focusTarget: {
        segmentId: expect.any(String),
        offset: 0,
      },
    });
  });

  test("removes a file reference and merges adjacent text segments", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("before ", "text-before"),
        createFileReferenceSegment(FILE, "file-1"),
        createTextSegment(" after", "text-after"),
      ],
    };

    const result = applyComposerDraftEdit(draft, {
      type: "remove_file_reference",
      segmentId: "file-1",
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

  test("preserves the existing trailing text segment id when normalizing text after a file chip", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("before ", "text-before"),
        createFileReferenceSegment(FILE, "file-1"),
        createTextSegment(" after", "text-after"),
      ],
    };

    expect(normalizeComposerDraft(draft)).toEqual({
      segments: [
        expect.objectContaining({ id: "text-before", kind: "text", text: "before " }),
        expect.objectContaining({ id: "file-1", kind: "file_reference", file: FILE }),
        expect.objectContaining({ id: "text-after", kind: "text", text: " after" }),
      ],
    });
  });

  test("exposes file autocomplete in the middle of draft text", () => {
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("hello @src/ma world", "text-1")],
    };

    expect(readFileTriggerMatchForDraft(draft, "text-1", 13)).toEqual({
      query: "src/ma",
      rangeStart: 6,
      rangeEnd: 13,
    });
  });

  test("does not expose file autocomplete inside email-like text", () => {
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("hello user@example.com", "text-1")],
    };

    expect(readFileTriggerMatchForDraft(draft, "text-1", 18)).toBeNull();
  });
});
