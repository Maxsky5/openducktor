import { LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GeneratedImageWorkers } from "./generated-image-worker-client";
import { invalidImage } from "./generated-image-decode";
import { readSavedImage } from "./generated-image-saved-file";
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
          Effect.map((bytes) => ({
            kind: "file" as const,
            bytes,
            itemId,
            revision: source.revision,
          })),
        ),
        itemId,
      );
    }),
});
