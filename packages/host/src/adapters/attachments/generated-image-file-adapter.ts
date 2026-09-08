import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import type { GeneratedImageWorkers } from "./generated-image-worker-client";
import { invalidImage } from "./generated-image-decode";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { GeneratedImageFilePort } from "../../ports/generated-image-file-port";

export const createGeneratedImageFileAdapter = (
  workers: GeneratedImageWorkers,
): GeneratedImageFilePort => ({
  read: (source, itemId) =>
    Effect.gen(function* () {
      if (source.representation === "inline") {
        if (source.base64.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT)
          return yield* Effect.fail(
            invalidImage(itemId, "output exceeds the 32 MiB preview limit."),
          );
        return yield* workers.preparePayload(
          Effect.succeed({
            kind: "inline",
            base64: source.base64,
            itemId,
          }),
          itemId,
        );
      }
      return yield* workers.preparePayload(
        readSavedImage(source.path, itemId).pipe(
          Effect.map((bytes) => ({ kind: "file" as const, bytes, itemId })),
        ),
        itemId,
      );
    }),
});

const imageReadError =
  (itemId: string): (() => HostOperationError<{ itemId: string }>) =>
  () =>
    new HostOperationError({
      operation: "generated-image.read",
      message: `Image '${itemId}' could not be read. Check that the runtime-reported saved file exists and is readable.`,
      details: { itemId },
    });

/** Read one open file handle so path changes cannot swap the file after the size check. */
const readSavedImage = (
  path: string,
  itemId: string,
): Effect.Effect<Buffer<ArrayBuffer>, HostError> => {
  if (!isAbsolute(path) || path.includes("\0"))
    return Effect.fail(invalidImage(itemId, "the runtime returned an invalid saved-file path."));
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const handle = yield* Effect.tryPromise({
        try: () =>
          open(
            path,
            constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK),
          ),
        catch: imageReadError(itemId),
      });
      const read = Effect.gen(function* () {
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
        // One extra byte detects growth after stat; the allocation stays within the limit plus one.
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
      });
      const readExit = yield* Effect.exit(restore(read));
      const closeExit = yield* Effect.exit(
        Effect.tryPromise({
          try: () => handle.close(),
          catch: () =>
            new HostOperationError({
              operation: "generated-image.read",
              message: `Image '${itemId}' could not be previewed because its saved file could not be closed. Reopen the preview.`,
              details: { itemId },
            }),
        }),
      );
      return yield* Exit.zipLeft(readExit, closeExit);
    }),
  );
};
