import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  createSlashCommandSegment,
  createSkillReferenceSegment,
  createTextSegment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  applyComposerTextChange,
  CHIP_MARGIN_END,
  CHIP_MARGIN_START,
  CHIP_PAD,
  caretInLayout,
  chipAtPosition,
  layoutComposerDraft,
  positionInLayout,
} from "./composer-text";

const review = createSlashCommandSegment(
  { id: "review", trigger: "review", title: "review", hints: [] },
  "chip-review",
);
const lint = createSkillReferenceSegment(
  { id: "lint", name: "lint", path: "/skills/lint" },
  "chip-lint",
);

const draftOf = (...segments: AgentChatComposerDraft["segments"]): AgentChatComposerDraft => ({
  segments,
  attachments: [],
});

/** The plain text and chips of a draft, for compact assertions. */
const segmentTexts = (draft: AgentChatComposerDraft): string[] =>
  draft.segments.map((segment) => (segment.kind === "text" ? segment.text : `[${segment.kind}]`));

/** The input text of the `/review` chip: margins and pads around a label with no break point. */
const REVIEW = `${CHIP_MARGIN_START}${CHIP_PAD}${Array.from("/review").join("\u2060")}${CHIP_PAD}${CHIP_MARGIN_END}`;

describe("layoutComposerDraft", () => {
  test("shows each chip as its pill label between text runs", () => {
    const layout = layoutComposerDraft(
      draftOf(createTextSegment("", "t1"), review, createTextSegment(" fix it", "t2")),
    );
    expect(layout.text).toBe(`${REVIEW} fix it`);
    expect(layout.spans.map((span) => [span.kind, span.start, span.end])).toEqual([
      ["text", 0, 0],
      ["chip", 0, REVIEW.length],
      ["text", REVIEW.length, REVIEW.length + 7],
    ]);
  });

  test("shows a skill by its name and shortens a long label", () => {
    const long = createSkillReferenceSegment(
      { id: "long", name: "a".repeat(40), path: "/skills/long" },
      "chip-long",
    );
    const [, lintSpan, , longSpan] = layoutComposerDraft(
      draftOf(createTextSegment("", "t1"), lint, createTextSegment("", "t2"), long),
    ).spans;
    expect(lintSpan?.kind === "chip" && lintSpan.label).toBe(Array.from("lint").join("\u2060"));
    // A skill pill has an icon, so its start pad is wider than the pad of a Slash Command.
    expect(lintSpan?.kind === "chip" && lintSpan.padStart).toBe(CHIP_PAD.repeat(3));
    expect(longSpan?.kind === "chip" && longSpan.label.replaceAll("\u2060", "")).toBe(
      `${"a".repeat(31)}…`,
    );
  });

  test("maps a caret between the input text and the text runs", () => {
    const layout = layoutComposerDraft(
      draftOf(createTextSegment("ab", "t1"), review, createTextSegment("cd", "t2")),
    );
    const after = 2 + REVIEW.length;
    expect(caretInLayout(layout, 1)).toEqual({ segmentId: "t1", offset: 1 });
    expect(caretInLayout(layout, after + 1)).toEqual({ segmentId: "t2", offset: 1 });
    expect(caretInLayout(layout, 6)).toBeNull();
    expect(positionInLayout(layout, { segmentId: "t2", offset: 0 })).toBe(after);
  });

  test("finds the chip that a caret falls inside, but not a caret at its edge", () => {
    const layout = layoutComposerDraft(
      draftOf(createTextSegment("ab", "t1"), review, createTextSegment("cd", "t2")),
    );
    expect(chipAtPosition(layout, 4)?.segmentId).toBe("chip-review");
    expect(chipAtPosition(layout, 2)).toBeNull();
    expect(chipAtPosition(layout, 2 + REVIEW.length)).toBeNull();
  });
});

describe("applyComposerTextChange", () => {
  const withChip = draftOf(createTextSegment("", "t1"), review, createTextSegment("", "t2"));

  test("adds typed text and a line break after a chip, in the text run after it", () => {
    const typed = applyComposerTextChange(withChip, `${REVIEW}fix`);
    expect(segmentTexts(typed.draft)).toEqual(["", "[slash_command]", "fix"]);
    expect(typed.caret).toBe(REVIEW.length + 3);
    const broken = applyComposerTextChange(typed.draft, `${REVIEW}fix\nmore`);
    expect(segmentTexts(broken.draft)).toEqual(["", "[slash_command]", "fix\nmore"]);
    expect(broken.text).toBe(`${REVIEW}fix\nmore`);
  });

  test("removes the whole chip when a deletion touches it", () => {
    const draft = draftOf(createTextSegment("go ", "t1"), review, createTextSegment("now", "t2"));
    // A backspace after the chip deletes its last character.
    const result = applyComposerTextChange(draft, `go ${REVIEW.slice(0, -1)}now`);
    expect(segmentTexts(result.draft)).toEqual(["go now"]);
    expect(result.text).toBe("go now");
    expect(result.caret).toBe(3);
  });

  test("removes the chip, not the typed space after it, with a backspace after the chip", () => {
    const draft = draftOf(createTextSegment("go ", "t1"), review, createTextSegment(" now", "t2"));
    const result = applyComposerTextChange(draft, `go ${REVIEW.slice(0, -1)} now`);
    expect(segmentTexts(result.draft)).toEqual(["go  now"]);
    expect(result.text).toBe("go  now");
    expect(result.caret).toBe(3);
  });

  test("keeps the text run ID of the edited text", () => {
    const draft = draftOf(createTextSegment("hello", "t1"));
    const result = applyComposerTextChange(draft, "hello!");
    expect(result.draft.segments[0]).toMatchObject({ id: "t1", text: "hello!" });
    expect(result.caret).toBe(6);
  });

  test("moves text typed inside a chip to after the chip", () => {
    const result = applyComposerTextChange(withChip, `${REVIEW.slice(0, 4)}X${REVIEW.slice(4)}`);
    expect(segmentTexts(result.draft)).toEqual(["", "[slash_command]", "X"]);
    expect(result.text).toBe(`${REVIEW}X`);
    expect(result.caret).toBe(REVIEW.length + 1);
  });

  test("removes every chip that a deleted selection covers", () => {
    const draft = draftOf(
      createTextSegment("a", "t1"),
      review,
      createTextSegment("b", "t2"),
      lint,
      createTextSegment("c", "t3"),
    );
    const result = applyComposerTextChange(draft, "ac");
    expect(segmentTexts(result.draft)).toEqual(["ac"]);
    expect(result.caret).toBe(1);
  });

  test("adds typed text before a chip to the text run before it", () => {
    const draft = draftOf(createTextSegment("a", "t1"), review, createTextSegment("", "t2"));
    const result = applyComposerTextChange(draft, `ab${REVIEW}`);
    expect(segmentTexts(result.draft)).toEqual(["ab", "[slash_command]", ""]);
    expect(result.caret).toBe(2);
  });
});
