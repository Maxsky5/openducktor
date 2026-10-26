import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  createFileReferenceSegment,
  createSkillReferenceSegment,
  createSlashCommandSegment,
  createSubagentReferenceSegment,
  createTextSegment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  buildComposerTokens,
  composerDraftPreview,
  insertSuggestionEdit,
  readComposerTrigger,
} from "./composer-segments";

const allSupport = {
  supportsSlashCommands: true,
  supportsFileSearch: true,
  supportsSubagentReferences: true,
  supportsSkillReferences: true,
};

const file = { id: "src/app.ts", path: "src/app.ts", name: "app.ts", kind: "code" as const };

describe("buildComposerTokens", () => {
  test("keeps segment order and labels each chip as the desktop chip", () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "t0"),
        createSlashCommandSegment(
          { id: "review", trigger: "review", title: "Review", source: "command", hints: [] },
          "c1",
        ),
        createTextSegment(" check ", "t1"),
        createFileReferenceSegment(file, "f1"),
        createTextSegment(" with ", "t2"),
        createSubagentReferenceSegment({ id: "w", name: "worker", label: "Worker" }, "s1"),
        createTextSegment(" ", "t3"),
        createSkillReferenceSegment({ id: "k", name: "lint", path: "/skills/lint" }, "k1"),
        createTextSegment("", "t4"),
      ],
      attachments: [],
    };

    const tokens = buildComposerTokens(draft);

    expect(
      tokens.map((token) => (token.kind === "text" ? `text:${token.text}` : token.label)),
    ).toEqual([
      "text:",
      "/review",
      "text: check ",
      "app.ts",
      "text: with ",
      "worker",
      "text: ",
      "lint",
      "text:",
    ]);
    expect(tokens[3]).toMatchObject({
      kind: "chip",
      chip: "file",
      fileKind: "code",
    });
    expect(composerDraftPreview(draft)).toBe("/review check app.ts with @worker $lint");
  });
});

describe("readComposerTrigger", () => {
  const draftWith = (text: string): AgentChatComposerDraft => ({
    segments: [createTextSegment(text, "t0")],
    attachments: [],
  });

  test("reads the trigger before the caret", () => {
    expect(readComposerTrigger(draftWith("/rev"), "t0", 4, allSupport)).toMatchObject({
      kind: "slash",
      query: "rev",
      rangeStart: 0,
      rangeEnd: 4,
    });
    expect(readComposerTrigger(draftWith("see @src/ap"), "t0", 11, allSupport)).toMatchObject({
      kind: "reference",
      query: "src/ap",
    });
    expect(readComposerTrigger(draftWith("use $li"), "t0", 7, allSupport)).toMatchObject({
      kind: "skill",
      query: "li",
    });
  });

  test("offers no trigger that the runtime does not support", () => {
    expect(
      readComposerTrigger(draftWith("see @src"), "t0", 8, {
        ...allSupport,
        supportsFileSearch: false,
        supportsSubagentReferences: false,
      }),
    ).toBeNull();
  });

  test("replaces the trigger text with the chosen chip", () => {
    const draft = draftWith("see @ap now");
    const trigger = readComposerTrigger(draft, "t0", 7, allSupport);
    if (!trigger) throw new Error("Expected a reference trigger.");

    const result = applyComposerDraftEdit(
      draft,
      insertSuggestionEdit(trigger, { kind: "file", id: "file:src/app.ts", file }),
    );

    expect(
      result
        ? buildComposerTokens(result.draft).map((token) =>
            token.kind === "text" ? token.text : token.label,
          )
        : null,
    ).toEqual(["see ", "app.ts", " now"]);
  });
});
