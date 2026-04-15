import { describe, expect, test } from "bun:test";
import { createFileReferenceSegment, createTextSegment } from "./agent-chat-composer-draft";
import {
  deriveTextSelectionTargetAfterInput,
  getLastTextSelectionTarget,
  parseComposerDraftFromRoot,
  resolveTextSelectionTarget,
} from "./use-agent-chat-composer-editor-selection";

describe("useAgentChatComposerEditorSelection helpers", () => {
  test("clamps remembered selections to the text segment bounds", () => {
    const draft = {
      segments: [createTextSegment("hello", "segment-1")],
      attachments: [],
    };

    expect(
      resolveTextSelectionTarget(draft, {
        segmentId: "segment-1",
        offset: 99,
      }),
    ).toEqual({
      segmentId: "segment-1",
      offset: 5,
    });
  });

  test("derives newline selection targets from the pending input state", () => {
    const draft = {
      segments: [createTextSegment("hello\nworld", "segment-1")],
      attachments: [],
    };

    expect(
      deriveTextSelectionTargetAfterInput(
        draft,
        {
          segmentId: "segment-1",
          offset: 5,
          inputType: "insertLineBreak",
          data: null,
        },
        null,
      ),
    ).toEqual({
      segmentId: "segment-1",
      offset: 6,
    });
  });

  test("falls back to the last text segment when remembered selection is unavailable", () => {
    const draft = {
      segments: [
        createFileReferenceSegment(
          {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          "file-segment",
        ),
        createTextSegment("tail", "segment-2"),
      ],
      attachments: [],
    };

    expect(deriveTextSelectionTargetAfterInput(draft, null, null)).toEqual(
      getLastTextSelectionTarget(draft),
    );
  });

  test("rebuilds a normalized draft from the editable DOM while preserving chip segments", () => {
    const root = document.createElement("div");
    const contentRoot = document.createElement("div");
    contentRoot.dataset.composerContentRoot = "true";
    root.append(contentRoot);

    const previousDraft = {
      segments: [
        createTextSegment("hello", "segment-1"),
        createFileReferenceSegment(
          {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          "file-segment",
        ),
        createTextSegment("world", "segment-2"),
      ],
      attachments: [],
    };

    const firstText = document.createElement("div");
    firstText.dataset.textSegmentId = "segment-1";
    firstText.textContent = "updated";
    contentRoot.append(firstText);

    const chip = document.createElement("span");
    chip.dataset.chipSegmentId = "file-segment";
    chip.dataset.segmentId = "file-segment";
    chip.textContent = "main.ts";
    contentRoot.append(chip);

    const trailingText = document.createElement("div");
    trailingText.dataset.textSegmentId = "segment-2";
    trailingText.textContent = "tail";
    contentRoot.append(trailingText);

    const nextDraft = parseComposerDraftFromRoot(root, previousDraft);

    expect(nextDraft.segments).toHaveLength(3);
    expect(nextDraft.segments[0]).toMatchObject({
      kind: "text",
      id: "segment-1",
      text: "updated",
    });
    expect(nextDraft.segments[1]).toBe(previousDraft.segments[1]);
    expect(nextDraft.segments[2]).toMatchObject({
      kind: "text",
      id: "segment-2",
      text: "tail",
    });
  });
});
