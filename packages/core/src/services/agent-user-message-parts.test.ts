import { describe, expect, test } from "bun:test";
import {
  buildAgentUserMessagePromptText,
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
  serializeAgentUserMessagePartsToText,
} from "./agent-user-message-parts";

const createCommand = () => ({
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: [],
});

const createFileReference = () => ({
  id: "src-index-ts",
  path: "src/index.ts",
  name: "index.ts",
  kind: "code" as const,
});

const createAttachment = () => ({
  id: "attachment-1",
  path: "/tmp/diagram.png",
  name: "diagram.png",
  kind: "image" as const,
  mime: "image/png",
});

describe("agent-user-message-parts", () => {
  test("merges adjacent text parts and trims only boundaries", () => {
    const command = createCommand();

    expect(
      normalizeAgentUserMessageParts([
        { kind: "text", text: "  hello" },
        { kind: "text", text: " world  " },
        { kind: "slash_command", command },
        { kind: "text", text: "  after  " },
      ]),
    ).toEqual([
      { kind: "text", text: "hello world  " },
      { kind: "slash_command", command },
      { kind: "text", text: "  after" },
    ]);
  });

  test("filters empty boundary text after trimming", () => {
    const command = createCommand();

    expect(
      normalizeAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "slash_command", command },
        { kind: "text", text: "   " },
      ]),
    ).toEqual([{ kind: "slash_command", command }]);
  });

  test("detects meaningful parts only after normalization", () => {
    const command = createCommand();
    const file = createFileReference();
    const attachment = createAttachment();

    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "text", text: "\n" },
      ]),
    ).toBe(false);
    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "slash_command", command },
      ]),
    ).toBe(true);
    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "file_reference", file },
      ]),
    ).toBe(true);
    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "attachment", attachment },
      ]),
    ).toBe(true);
  });

  test("serializes mixed text and slash command parts", () => {
    const command = createCommand();

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "  hi" },
        { kind: "text", text: ", there  " },
        { kind: "slash_command", command },
        { kind: "text", text: " -- now" },
      ]),
    ).toBe("hi, there  /compact -- now");
  });

  test("preserves file references during normalization and serializes them as paths", () => {
    const file = createFileReference();

    expect(
      normalizeAgentUserMessageParts([
        { kind: "text", text: "  see " },
        { kind: "file_reference", file },
        { kind: "text", text: "  please  " },
      ]),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "file_reference", file },
      { kind: "text", text: "  please" },
    ]);

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "  see " },
        { kind: "file_reference", file },
        { kind: "text", text: " now  " },
      ]),
    ).toBe("see @src/index.ts now");

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "And now tell me if " },
        {
          kind: "file_reference",
          file: {
            ...file,
            path: "apps/api/src/routes/members.ts",
            name: "members.ts",
          },
        },
        { kind: "text", text: "and " },
        {
          kind: "file_reference",
          file: {
            ...file,
            id: "apps-web-account",
            path: "apps/web/src/routes/_authenticated/account.tsx",
            name: "account.tsx",
          },
        },
        { kind: "text", text: "are consistents?" },
      ]),
    ).toBe(
      "And now tell me if @apps/api/src/routes/members.ts and @apps/web/src/routes/_authenticated/account.tsx are consistents?",
    );
  });

  test("does not synthesize spaces before punctuation after file references", () => {
    const file = createFileReference();

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "check (" },
        { kind: "file_reference", file },
        { kind: "text", text: ")." },
      ]),
    ).toBe("check (@src/index.ts).");
  });

  test("builds upstream prompt text with inline file-reference spans", () => {
    const file = createFileReference();
    const attachment = createAttachment();

    expect(
      buildAgentUserMessagePromptText([
        { kind: "text", text: "check " },
        { kind: "file_reference", file },
        { kind: "text", text: " please" },
      ]),
    ).toEqual({
      text: "check @src/index.ts please",
      fileReferences: [
        {
          file,
          sourceText: {
            value: "@src/index.ts",
            start: 6,
            end: 19,
          },
        },
      ],
    });

    expect(
      buildAgentUserMessagePromptText([
        { kind: "text", text: "compare " },
        { kind: "file_reference", file },
        { kind: "text", text: "and docs" },
      ]),
    ).toEqual({
      text: "compare @src/index.ts and docs",
      fileReferences: [
        {
          file,
          sourceText: {
            value: "@src/index.ts",
            start: 8,
            end: 21,
          },
        },
      ],
    });

    expect(
      buildAgentUserMessagePromptText([
        { kind: "text", text: "review " },
        { kind: "attachment", attachment },
        { kind: "text", text: "with " },
        { kind: "file_reference", file },
      ]),
    ).toEqual({
      text: "review with @src/index.ts",
      fileReferences: [
        {
          file,
          sourceText: {
            value: "@src/index.ts",
            start: 12,
            end: 25,
          },
        },
      ],
    });
  });

  test("does not flatten attachments into serialized prompt text", () => {
    const attachment = createAttachment();

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "  describe " },
        { kind: "attachment", attachment },
        { kind: "text", text: " carefully  " },
      ]),
    ).toBe("describe carefully");

    expect(serializeAgentUserMessagePartsToText([{ kind: "attachment", attachment }])).toBe("");
  });
});
