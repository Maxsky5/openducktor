import { describe, expect, test } from "bun:test";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import {
  attachmentKindsText,
  intakePickedFiles,
  resolveAttachmentPickers,
} from "./composer-attachments";

const picked = (name: string, type: string, size = 1_000): DeviceFileReference => ({
  name,
  type,
  size,
});

const support = { image: true, audio: false, video: false, pdf: true };

describe("resolveAttachmentPickers", () => {
  test("offers only the kinds that the selected model supports", () => {
    expect(resolveAttachmentPickers({ runtimeSupportsAttachments: true, support })).toEqual({
      library: true,
      documentTypes: ["image/*", "application/pdf"],
      kinds: ["image", "pdf"],
      unavailableReason: null,
    });
    expect(attachmentKindsText(["image", "pdf"])).toBe("images and PDFs");
  });

  test("offers no picker and says why when the model takes no file", () => {
    expect(
      resolveAttachmentPickers({
        runtimeSupportsAttachments: true,
        support: { image: false, audio: false, video: false, pdf: false },
      }),
    ).toMatchObject({
      library: false,
      documentTypes: [],
      unavailableReason: "The selected model takes no attachments.",
    });
    expect(
      resolveAttachmentPickers({ runtimeSupportsAttachments: false, support }).unavailableReason,
    ).toBe("The runtime of this session takes no attachments.");
    expect(
      resolveAttachmentPickers({ runtimeSupportsAttachments: true, support: null })
        .unavailableReason,
    ).toBe("The selected model does not say which attachments it takes.");
  });
});

describe("intakePickedFiles", () => {
  test("accepts a device photo as an image and keeps the picked file", () => {
    const photo = picked("IMG_0042.jpg", "image/jpeg");

    const { attachments, rejected } = intakePickedFiles([photo]);

    expect(rejected).toEqual([]);
    expect(attachments[0]).toMatchObject({
      name: "IMG_0042.jpg",
      kind: "image",
      mime: "image/jpeg",
    });
    expect(attachments[0]?.file).toBe(photo);
  });

  test("keeps out a file over the host size limit with the reason", () => {
    const { attachments, rejected } = intakePickedFiles([
      picked("movie.mp4", "video/mp4", LOCAL_ATTACHMENT_BYTE_LIMIT + 1),
    ]);

    expect(attachments).toEqual([]);
    expect(rejected).toEqual([
      {
        name: "movie.mp4",
        reason: "movie.mp4 is larger than 32 MiB, the host limit for attachments.",
      },
    ]);
  });

  test("keeps out a file that is not an image, audio file, video, or PDF", () => {
    expect(intakePickedFiles([picked("notes.zip", "application/zip")]).rejected).toEqual([
      { name: "notes.zip", reason: "notes.zip is not an image, audio file, video, or PDF." },
    ]);
  });
});
