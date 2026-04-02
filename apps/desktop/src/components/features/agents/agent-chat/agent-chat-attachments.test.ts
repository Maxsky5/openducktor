import { describe, expect, test } from "bun:test";
import {
  buildComposerAttachmentFromFile,
  buildComposerAttachmentFromPath,
  validateComposerAttachments,
} from "./agent-chat-attachments";

describe("agent-chat-attachments", () => {
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

  test("validates staged attachments against model capability data", () => {
    const pdfAttachment = buildComposerAttachmentFromPath("/tmp/brief.pdf");
    const imageAttachment = buildComposerAttachmentFromPath("/tmp/photo.png");
    if (!pdfAttachment || !imageAttachment) {
      throw new Error("Expected fixture attachments to classify");
    }

    expect(validateComposerAttachments([pdfAttachment], null)).toEqual({
      [pdfAttachment.id]: "The selected model does not expose attachment capability data.",
    });

    expect(
      validateComposerAttachments([pdfAttachment, imageAttachment], {
        pdf: true,
        image: false,
        audio: false,
        video: false,
      }),
    ).toEqual({
      [imageAttachment.id]: "The selected model does not support image attachments.",
    });
  });
});
