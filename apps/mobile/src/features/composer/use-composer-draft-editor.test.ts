import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  createSlashCommandSegment,
  createTextSegment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { act, renderHook, waitFor } from "@testing-library/react";
import { layoutComposerDraft } from "./composer-text";
import { useComposerDraftEditor } from "./use-composer-draft-editor";

const review = { id: "review", trigger: "review", title: "review", hints: [] };

const draftWith = (text: string, id: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, id)],
  attachments: [],
});

const renderEditor = (initial: AgentChatComposerDraft) => {
  const commits: AgentChatComposerDraft[] = [];
  const hook = renderHook(
    ({ draft }: { draft: AgentChatComposerDraft }) =>
      useComposerDraftEditor({ draft, commitDraft: (next) => commits.push(next) }),
    { initialProps: { draft: initial } },
  );
  return { ...hook, commits };
};

describe("useComposerDraftEditor", () => {
  test("keeps the caret in the field when a send clears the focused draft", () => {
    const { result, rerender } = renderEditor(draftWith("Fix the build", "text-1"));
    act(() => result.current.noteFocus(true));
    rerender({ draft: createEmptyComposerDraft() });

    expect(result.current.selectionRequest).toMatchObject({ position: 0 });
  });

  test("puts the caret at the end of a restored draft", () => {
    const { result, rerender } = renderEditor(createEmptyComposerDraft());
    act(() => result.current.noteFocus(true));
    rerender({ draft: draftWith("Fix the build", "text-2") });

    expect(result.current.selectionRequest).toMatchObject({ position: 13 });
    expect(result.current.caret).toEqual({ segmentId: "text-2", offset: 13 });
  });

  test("does not move the caret for a draft from outside an unfocused field", () => {
    const { result, rerender } = renderEditor(createEmptyComposerDraft());
    rerender({ draft: draftWith("Saved draft", "text-3") });

    expect(result.current.selectionRequest).toBeNull();
    expect(result.current.caret).toBeNull();
  });

  test("removes a chip with a backspace and moves the caret to where it was", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("go ", "text-4"),
        createSlashCommandSegment(review, "chip"),
        createTextSegment("", "text-5"),
      ],
      attachments: [],
    };
    const { result, commits } = renderEditor(draft);
    // A backspace after the chip deletes the last character of its text.
    act(() => result.current.changeText(layoutComposerDraft(draft).text.slice(0, -1)));

    expect(commits.at(-1)?.segments.map((segment) => segment.kind)).toEqual(["text"]);
    expect(result.current.selectionRequest).toMatchObject({ position: 3 });
  });

  test("moves a caret that a tap puts inside a chip to the end of the chip", async () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("go ", "text-7"),
        createSlashCommandSegment(review, "chip-2"),
        createTextSegment(" now", "text-8"),
      ],
      attachments: [],
    };
    const chip = layoutComposerDraft(draft).spans[1];
    if (!chip) throw new Error("The draft has no chip.");
    const { result } = renderEditor(draft);
    act(() => result.current.select(chip.start + 2, chip.start + 2));

    // The snap waits one frame for the text change of the same edit.
    await waitFor(() =>
      expect(result.current.selectionRequest).toMatchObject({ position: chip.end }),
    );
    expect(result.current.caret).toEqual({ segmentId: "text-8", offset: 0 });
  });

  test("puts the caret after a chip that a suggestion inserted", () => {
    const { result, commits } = renderEditor(draftWith("/rev", "text-6"));
    act(() => {
      result.current.applyStructuralEdit({
        type: "insert_slash_command",
        textSegmentId: "text-6",
        rangeStart: 0,
        rangeEnd: 4,
        command: review,
      });
    });
    const inserted = commits.at(-1);
    if (!inserted) throw new Error("The edit committed no draft.");
    const chip = layoutComposerDraft(inserted).spans.find((span) => span.kind === "chip");

    expect(result.current.selectionRequest).toMatchObject({ position: chip?.end });
  });
});
