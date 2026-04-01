import { describe, expect, test } from "bun:test";
import { detectAgentFileReferenceKind, detectAgentFileReferenceMime } from "./file-reference-utils";

describe("file-reference-utils", () => {
  test("detects kinds from mime and path consistently", () => {
    expect(
      detectAgentFileReferenceKind({
        filePath: "src/styles.scss",
      }),
    ).toBe("css");

    expect(
      detectAgentFileReferenceKind({
        filePath: "assets/diagram.png",
      }),
    ).toBe("image");

    expect(
      detectAgentFileReferenceKind({
        filePath: "recordings/demo.mov",
      }),
    ).toBe("video");

    expect(
      detectAgentFileReferenceKind({
        filePath: "notes/todo.txt",
        mime: "image/webp",
      }),
    ).toBe("image");

    expect(
      detectAgentFileReferenceKind({
        filePath: "src/components",
        isDirectory: true,
      }),
    ).toBe("directory");
  });

  test("maps image and video file refs to media mimes", () => {
    expect(
      detectAgentFileReferenceMime({
        path: "assets/diagram.svg",
        kind: "image",
      }),
    ).toBe("image/svg+xml");

    expect(
      detectAgentFileReferenceMime({
        path: "recordings/demo.mov",
        kind: "video",
      }),
    ).toBe("video/quicktime");

    expect(
      detectAgentFileReferenceMime({
        path: "src/main.ts",
        kind: "code",
      }),
    ).toBe("text/plain");
  });
});
