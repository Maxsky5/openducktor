import { describe, expect, test } from "bun:test";
import { buildComposerAttachmentFromFile } from "./agent-chat-attachment-files";

describe("agent-chat-attachment-files", () => {
  test("classifies supported browser files into composer attachments", () => {
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });

    const attachment = buildComposerAttachmentFromFile(file);

    expect(attachment).toMatchObject({
      name: "brief.pdf",
      kind: "pdf",
      mime: "application/pdf",
      file,
    });
    expect(attachment?.path).toBeUndefined();
  });

  test("rejects unsupported files", () => {
    const file = new File(["zip"], "archive.zip", { type: "application/zip" });

    expect(buildComposerAttachmentFromFile(file)).toBeNull();
  });

  test("normalizes unnamed browser files to a usable attachment filename", () => {
    const file = new File(["image"], "", { type: "image/png" });

    const attachment = buildComposerAttachmentFromFile(file);

    expect(attachment).toMatchObject({
      name: "pasted-image.png",
      kind: "image",
      mime: "image/png",
    });
    expect(attachment?.file).toBeInstanceOf(File);
    expect(attachment?.file?.name).toBe("pasted-image.png");
  });

  test("recognizes images by extension when the browser reports a generic type", () => {
    const attachment = buildComposerAttachmentFromFile(
      new File(["image"], "photo.png", { type: "application/octet-stream" }),
    );

    expect(attachment).toMatchObject({ name: "photo.png", kind: "image" });
  });
});
