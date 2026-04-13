import { describe, expect, test } from "bun:test";
import {
  buildOpenCodePromptText,
  buildOpenCodeVisibleText,
} from "./opencode-user-message-encoding";
import { buildQueuedRequestSignature } from "./user-message-signatures";

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

describe("opencode-user-message-encoding", () => {
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
    });
  });

  test("queued request signatures reuse the same visible text as prompt encoding", () => {
    const parts = [
      { kind: "file_reference" as const, file: FIRST_FILE },
      { kind: "attachment" as const, attachment: ATTACHMENT },
      { kind: "file_reference" as const, file: SECOND_FILE },
    ];

    expect(JSON.parse(buildQueuedRequestSignature(parts))).toEqual({
      visible: "@src/a.ts @src/b.ts",
      nonTextParts: [
        {
          kind: "file_reference",
          path: "src/a.ts",
          name: "a.ts",
          sourceText: {
            value: "@src/a.ts",
            start: 0,
            end: 9,
          },
        },
        {
          kind: "file_reference",
          path: "src/b.ts",
          name: "b.ts",
          sourceText: {
            value: "@src/b.ts",
            start: 10,
            end: 19,
          },
        },
        {
          kind: "attachment",
          path: "/tmp/diagram.png",
          name: "diagram.png",
          attachmentKind: "image",
          mime: "image/png",
        },
      ],
      providerId: null,
      modelId: null,
      variant: null,
      profileId: null,
    });
  });
});
