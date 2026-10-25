import { describe, expect, test } from "bun:test";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type { DeviceFileReference } from "../platform/device-file";
import {
  buildComposerAttachmentFromDeviceFile,
  buildComposerAttachmentFromPath,
  classifyAttachment,
  inferAttachmentMime,
  readAttachmentFileName,
  readAttachmentNameFromPath,
  validateComposerAttachments,
} from "./agent-chat-attachments";
import { createComposerAttachment } from "./agent-chat-composer-draft";

const createDeviceFile = (name: string, type: string, size = 1): DeviceFileReference => ({
  name,
  type,
  size,
});

describe("agent-chat-attachments", () => {
  test("classifies supported device files by MIME type", () => {
    expect(classifyAttachment({ name: "brief.pdf", mime: "application/pdf" })).toBe("pdf");
    expect(inferAttachmentMime("brief.pdf", "application/pdf")).toBe("application/pdf");
  });

  test("rejects unsupported files", () => {
    expect(classifyAttachment({ name: "archive.zip", mime: "application/zip" })).toBeNull();
  });

  test("names unnamed device files with a usable attachment filename", () => {
    expect(classifyAttachment({ name: "", mime: "image/png" })).toBe("image");
    expect(readAttachmentFileName({ name: "", mime: "image/png", kind: "image" })).toBe(
      "pasted-image.png",
    );
    expect(inferAttachmentMime("pasted-image.png", "image/png")).toBe("image/png");
  });

  test("returns a non-empty fallback label for unnamed unsupported files", () => {
    expect(readAttachmentFileName({ name: "", mime: "application/zip" })).toBe("pasted-attachment");
  });

  test("preserves existing non-empty filenames verbatim", () => {
    expect(
      readAttachmentFileName({
        name: " report .pdf ",
        mime: "application/pdf",
      }),
    ).toBe(" report .pdf ");
  });

  test("rehydrates uncommon supported extensions from their path", () => {
    const attachment = buildComposerAttachmentFromPath("/tmp/preview.avif");

    expect(attachment).toMatchObject({
      name: "preview.avif",
      kind: "image",
      mime: "image/avif",
      path: "/tmp/preview.avif",
    });
  });

  test("reads attachment names from slash and backslash separated paths", () => {
    expect(readAttachmentNameFromPath("/tmp/screenshots/preview.png")).toBe("preview.png");
    expect(readAttachmentNameFromPath("C:\\Users\\max\\Downloads\\recording.webm")).toBe(
      "recording.webm",
    );
    expect(readAttachmentNameFromPath("/tmp/screenshots/")).toBe("screenshots");
  });

  test("prefers persisted metadata when rebuilding from path", () => {
    const attachment = buildComposerAttachmentFromPath("/tmp/blob.bin", {
      name: "recording-from-runtime",
      kind: "audio",
      mime: "audio/ogg",
    });

    expect(attachment).toMatchObject({
      name: "recording-from-runtime",
      kind: "audio",
      mime: "audio/ogg",
      path: "/tmp/blob.bin",
    });
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

  test("validates staged attachments against model MIME constraints", () => {
    const heicAttachment = buildComposerAttachmentFromPath("/tmp/photo.heic");
    const pngAttachment = buildComposerAttachmentFromPath("/tmp/photo.png");
    if (!heicAttachment || !pngAttachment) {
      throw new Error("Expected fixture attachments to classify");
    }

    expect(
      validateComposerAttachments([heicAttachment, pngAttachment], {
        pdf: true,
        image: true,
        audio: false,
        video: false,
        mimeTypes: {
          image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
          pdf: ["application/pdf"],
        },
      }),
    ).toEqual({
      [heicAttachment.id]:
        "The selected model supports image attachments only as image/jpeg, image/png, image/gif, image/webp.",
    });
  });

  test("uses supported filename extensions when platforms report generic or alias MIME types", () => {
    expect(classifyAttachment({ name: "photo.png", mime: "application/octet-stream" })).toBe(
      "image",
    );
    expect(classifyAttachment({ name: "photo.jpg", mime: "image/jpg" })).toBe("image");
    const genericPng = createComposerAttachment({
      name: "photo.png",
      kind: "image",
      mime: "application/octet-stream",
      file: createDeviceFile("photo.png", "application/octet-stream"),
    });
    const aliasJpeg = createComposerAttachment({
      name: "photo.jpg",
      kind: "image",
      mime: "image/jpg",
      file: createDeviceFile("photo.jpg", "image/jpg"),
    });

    expect(
      validateComposerAttachments([genericPng, aliasJpeg], {
        pdf: true,
        image: true,
        audio: false,
        video: false,
        mimeTypes: {
          image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
          pdf: ["application/pdf"],
        },
      }),
    ).toEqual({});
  });

  test("rejects files whose combined size exceeds the staging limit", () => {
    const first = createComposerAttachment({
      name: "first.pdf",
      kind: "pdf",
      mime: "application/pdf",
      file: createDeviceFile("first.pdf", "application/pdf", LOCAL_ATTACHMENT_BYTE_LIMIT / 2 + 1),
    });
    const second = createComposerAttachment({
      name: "second.pdf",
      kind: "pdf",
      mime: "application/pdf",
      file: createDeviceFile("second.pdf", "application/pdf", LOCAL_ATTACHMENT_BYTE_LIMIT / 2),
    });

    expect(
      validateComposerAttachments([first, second], {
        pdf: true,
        image: false,
        audio: false,
        video: false,
      }),
    ).toEqual({
      [second.id]: "Attachments must total 32 MiB or less.",
    });
  });
});

describe("buildComposerAttachmentFromDeviceFile", () => {
  test("keeps the picked file and its kind and media type", () => {
    const file = createDeviceFile("brief.pdf", "application/pdf");

    const attachment = buildComposerAttachmentFromDeviceFile(file);

    expect(attachment).toMatchObject({ name: "brief.pdf", kind: "pdf", mime: "application/pdf" });
    expect(attachment?.file).toBe(file);
    expect(attachment?.path).toBeUndefined();
  });

  test("accepts a device photo by its extension when the type is unknown", () => {
    const attachment = buildComposerAttachmentFromDeviceFile(createDeviceFile("IMG_0001.JPG", ""));

    expect(attachment).toMatchObject({ name: "IMG_0001.JPG", kind: "image", mime: "image/jpeg" });
  });

  test("rejects a file that is not an image, audio file, video, or PDF", () => {
    expect(
      buildComposerAttachmentFromDeviceFile(createDeviceFile("notes.zip", "application/zip")),
    ).toBeNull();
  });

  test("names an unnamed file for its kind and renames the file only when asked", () => {
    const file = createDeviceFile("", "image/png");
    const renamed: DeviceFileReference[] = [];

    const kept = buildComposerAttachmentFromDeviceFile(file);
    const withRename = buildComposerAttachmentFromDeviceFile(file, (picked, name) => {
      const next = { ...picked, name };
      renamed.push(next);
      return next;
    });

    expect(kept).toMatchObject({ name: "pasted-image.png", kind: "image" });
    expect(kept?.file).toBe(file);
    expect(withRename?.file).toBe(renamed[0]);
    expect(withRename?.file?.name).toBe("pasted-image.png");
  });
});
