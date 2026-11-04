import { issueImageGetResultSchema, type IssueImageGetResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";

/** Checks the bytes of an issue image and returns its supported media type. */
export const detectIssueImageMediaType = (
  bytes: Uint8Array,
  provider: { label: string; operation: string; unsupportedMessage: string },
): Effect.Effect<IssueImageGetResult["mediaType"], HostOperationError | HostValidationError> =>
  Effect.gen(function* () {
    const detected = yield* Effect.tryPromise({
      try: () => fileTypeFromBuffer(bytes),
      catch: (cause) =>
        new HostOperationError({
          operation: provider.operation,
          message: `${provider.label} image data could not be checked. Retry the image.`,
          cause,
        }),
    });
    const mediaType = issueImageGetResultSchema.shape.mediaType.safeParse(detected?.mime);
    if (!mediaType.success)
      return yield* Effect.fail(
        new HostValidationError({ field: "url", message: provider.unsupportedMessage }),
      );
    return mediaType.data;
  });
