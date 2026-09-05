import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GeneratedImageFilePort } from "../../ports/generated-image-file-port";

const invalidImage = (itemId: string, reason: string) =>
  new HostValidationError({
    field: "image",
    message: `Image '${itemId}' cannot be previewed: ${reason}`,
    details: { itemId, operation: "generated-image.read" },
  });

const imageReadError = (itemId: string) => () =>
  new HostOperationError({
    operation: "generated-image.read",
    message: `Image '${itemId}' could not be read. Check that the runtime-reported saved file exists and is readable.`,
    details: { itemId },
  });

const base64Value = (code: number): number => {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
};

const decodeInlineImage = (base64: string, itemId: string): Buffer => {
  if (base64.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT)
    throw invalidImage(itemId, "output exceeds the 32 MiB preview limit.");
  if (base64.length === 0 || base64.length % 4 !== 0)
    throw invalidImage(itemId, "the runtime returned malformed base64 image data.");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length / 4) * 3 - padding;
  if (byteLength > LOCAL_ATTACHMENT_BYTE_LIMIT)
    throw invalidImage(itemId, "output exceeds the 32 MiB preview limit.");
  const end = base64.length - padding;
  for (let index = 0; index < end; index++) {
    if (base64Value(base64.charCodeAt(index)) < 0)
      throw invalidImage(itemId, "the runtime returned malformed base64 image data.");
  }
  const tail = base64Value(base64.charCodeAt(end - 1));
  if ((padding === 2 && (tail & 15) !== 0) || (padding === 1 && (tail & 3) !== 0)) {
    throw invalidImage(itemId, "the runtime returned malformed base64 padding.");
  }
  return Buffer.from(base64, "base64");
};

const readSavedImage = (path: string, itemId: string) => {
  if (!isAbsolute(path) || path.includes("\0"))
    return Effect.fail(invalidImage(itemId, "the runtime returned an invalid saved-file path."));
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        open(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK)),
      catch: imageReadError(itemId),
    }),
    (handle) =>
      Effect.gen(function* () {
        const metadata = yield* Effect.tryPromise({
          try: () => handle.stat(),
          catch: imageReadError(itemId),
        });
        if (!metadata.isFile())
          return yield* Effect.fail(
            invalidImage(itemId, "the saved output is not a regular file."),
          );
        if (metadata.size > LOCAL_ATTACHMENT_BYTE_LIMIT)
          return yield* Effect.fail(
            invalidImage(itemId, "output exceeds the 32 MiB preview limit."),
          );
        // One extra byte detects growth without allocating beyond the declared size limit.
        const bytes = Buffer.alloc(metadata.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const result = yield* Effect.tryPromise({
            try: () => handle.read(bytes, offset, bytes.length - offset, offset),
            catch: imageReadError(itemId),
          });
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        if (offset > metadata.size)
          return yield* Effect.fail(
            invalidImage(
              itemId,
              "the saved image grew during the read. Reopen the preview after the runtime finishes saving it.",
            ),
          );
        return bytes.subarray(0, offset);
      }),
    (handle) =>
      Effect.tryPromise({ try: () => handle.close(), catch: imageReadError(itemId) }).pipe(
        Effect.orDie,
      ),
  );
};

export const createGeneratedImageFileAdapter = (): GeneratedImageFilePort => ({
  read: (source, itemId) =>
    Effect.gen(function* () {
      const bytes = yield* source.representation === "saved_file"
        ? readSavedImage(source.path, itemId)
        : Effect.try({
            try: () => decodeInlineImage(source.base64, itemId),
            catch: (cause) =>
              cause instanceof HostValidationError
                ? cause
                : invalidImage(itemId, "the runtime image data could not be decoded."),
          });
      const detected = yield* Effect.tryPromise({
        try: () => fileTypeFromBuffer(bytes),
        catch: () =>
          invalidImage(
            itemId,
            "the runtime returned an incomplete or malformed PNG. Check the runtime output.",
          ),
      });
      if (detected?.mime !== "image/png")
        return yield* Effect.fail(
          invalidImage(itemId, "only PNG image output is supported. Check the runtime output."),
        );
      return {
        mime: "image/png" as const,
        byteLength: bytes.byteLength,
        base64: bytes.toString("base64"),
      };
    }),
});
