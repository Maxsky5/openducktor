import { describe, expect, test } from "bun:test";
import {
  createFileReferenceSegment,
  createSlashCommandSegment,
  createTextSegment,
} from "./agent-chat-composer-draft";
import {
  resolveReusablePromptDraftToUserMessageParts,
  toReusablePromptSlashCommand,
} from "./agent-chat-custom-prompts";

const PROMPT = {
  id: "prompt-1",
  name: "review",
  description: "Review context",
  content: "Review this:\n$ARGUMENTS\nAgain: $ARGUMENTS",
};

const CUSTOM_COMMAND = toReusablePromptSlashCommand(PROMPT);

describe("agent chat reusable prompts", () => {
  test("expands every arguments placeholder", () => {
    const parts = resolveReusablePromptDraftToUserMessageParts(
      {
        segments: [
          createTextSegment("", "before"),
          createSlashCommandSegment(CUSTOM_COMMAND, "slash"),
          createTextSegment(" src/foo.ts ", "after"),
        ],
        attachments: [],
      },
      [PROMPT],
    );

    expect(parts).toEqual([{ kind: "text", text: "Review this:\nsrc/foo.ts\nAgain: src/foo.ts" }]);
  });

  test("appends arguments when no placeholder is present", () => {
    const promptWithoutPlaceholder = { ...PROMPT, content: "Review this carefully." };
    const parts = resolveReusablePromptDraftToUserMessageParts(
      {
        segments: [
          createTextSegment("", "before"),
          createSlashCommandSegment(
            toReusablePromptSlashCommand(promptWithoutPlaceholder),
            "slash",
          ),
          createTextSegment(" src/foo.ts ", "after"),
        ],
        attachments: [],
      },
      [promptWithoutPlaceholder],
    );

    expect(parts).toEqual([{ kind: "text", text: "Review this carefully.\nsrc/foo.ts" }]);
  });

  test("rejects file references in reusable prompt drafts", () => {
    expect(() =>
      resolveReusablePromptDraftToUserMessageParts(
        {
          segments: [
            createTextSegment("", "before"),
            createSlashCommandSegment(CUSTOM_COMMAND, "slash"),
            createFileReferenceSegment(
              { id: "file", path: "src/foo.ts", name: "foo.ts", kind: "code" },
              "file",
            ),
            createTextSegment("", "after"),
          ],
          attachments: [],
        },
        [PROMPT],
      ),
    ).toThrow("Remove file references before sending a reusable prompt slash command.");
  });

  test("rejects placeholder-only prompts when arguments are empty", () => {
    const placeholderOnlyPrompt = { ...PROMPT, content: "$ARGUMENTS" };

    expect(() =>
      resolveReusablePromptDraftToUserMessageParts(
        {
          segments: [
            createTextSegment("", "before"),
            createSlashCommandSegment(toReusablePromptSlashCommand(placeholderOnlyPrompt), "slash"),
            createTextSegment("   ", "after"),
          ],
          attachments: [],
        },
        [placeholderOnlyPrompt],
      ),
    ).toThrow("Reusable prompt produced an empty message");
  });
});
