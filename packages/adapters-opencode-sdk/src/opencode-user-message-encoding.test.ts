import { describe, expect, test } from "bun:test";
import {
  buildOpenCodePromptText,
  buildOpenCodeVisibleText,
} from "./opencode-user-message-encoding";

const FIRST_FILE = {
  id: "file-a",
  path: "src/a.ts",
  name: "a.ts",
  kind: "code" as const,
};

const SECOND_FILE = {
  id: "file-b",
  path: "src/b.ts",
  name: "b.ts",
  kind: "code" as const,
};

const ATTACHMENT = {
  id: "attachment-1",
  path: "/tmp/diagram.png",
  name: "diagram.png",
  kind: "image" as const,
  mime: "image/png",
};

const SUBAGENT = {
  id: "reviewer",
  name: "reviewer",
  label: "Reviewer",
};

describe("opencode-user-message-encoding", () => {
  test("preserves text boundaries and reference offsets", () => {
    const text = "\n  Custom instruction\n{{task.title}}\n ";
    expect(buildOpenCodePromptText([{ kind: "text", text }]).text).toBe(text);
    const encoded = buildOpenCodePromptText([
      { kind: "text", text },
      { kind: "file_reference", file: FIRST_FILE },
    ]);
    expect(encoded.text).toBe(`${text}@src/a.ts`);
    expect(encoded.fileReferences[0]?.sourceText.start).toBe(text.length);
  });
  test("does not leave doubled synthetic spaces when skipped attachments sit between file references", () => {
    const parts = [
      { kind: "file_reference" as const, file: FIRST_FILE },
      { kind: "attachment" as const, attachment: ATTACHMENT },
      { kind: "file_reference" as const, file: SECOND_FILE },
    ];

    expect(buildOpenCodeVisibleText(parts)).toBe("@src/a.ts @src/b.ts");
    expect(buildOpenCodePromptText(parts)).toEqual({
      text: "@src/a.ts @src/b.ts",
      fileReferences: [
        {
          file: FIRST_FILE,
          sourceText: {
            value: "@src/a.ts",
            start: 0,
            end: 9,
          },
        },
        {
          file: SECOND_FILE,
          sourceText: {
            value: "@src/b.ts",
            start: 10,
            end: 19,
          },
        },
      ],
      subagentReferences: [],
      skillReferences: [],
    });
  });

  test("records subagent source spans for native agent prompt parts", () => {
    const parts = [
      { kind: "text" as const, text: "ask " },
      { kind: "subagent_reference" as const, subagent: SUBAGENT },
      { kind: "text" as const, text: " about this" },
    ];

    expect(buildOpenCodePromptText(parts)).toEqual({
      text: "ask @reviewer about this",
      fileReferences: [],
      skillReferences: [],
      subagentReferences: [
        {
          subagent: SUBAGENT,
          sourceText: {
            value: "@reviewer",
            start: 4,
            end: 13,
          },
        },
      ],
    });
  });
});
