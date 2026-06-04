import { describe, expect, test } from "bun:test";
import { detectAgentFileReferenceKind } from "./agent-file-references";

describe("agent file references", () => {
  test("detects file reference kinds from path, mime, and directory metadata", () => {
    expect(detectAgentFileReferenceKind({ filePath: "src/styles.scss" })).toBe("css");
    expect(detectAgentFileReferenceKind({ filePath: "src/main.ts" })).toBe("code");
    expect(detectAgentFileReferenceKind({ filePath: "assets/diagram.png" })).toBe("image");
    expect(detectAgentFileReferenceKind({ filePath: "recordings/demo.mov" })).toBe("video");
    expect(detectAgentFileReferenceKind({ filePath: "README", mime: "image/webp" })).toBe("image");
    expect(detectAgentFileReferenceKind({ filePath: "src/components", isDirectory: true })).toBe(
      "directory",
    );
    expect(detectAgentFileReferenceKind({ filePath: "notes/todo" })).toBe("default");
  });
});
