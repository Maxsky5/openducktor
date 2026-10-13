import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createLocalAttachmentAdapter } from "@openducktor/host";
import { Effect } from "effect";
import { lookup as lookupMimeType } from "mime-types";
import { errorMessage, WebHostRequestError } from "./effect/web-errors";
import { nodeReadableStream } from "./node-readable-stream";
const rejectWebHostRequest = (message: string, status: number) =>
  Effect.fail(new WebHostRequestError({ message, status }));
const isWithinDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const statLocalAttachmentPreview = (
  requestedPath: string,
): Effect.Effect<Stats, WebHostRequestError> =>
  Effect.tryPromise({
    try: () => stat(requestedPath),
    catch: (error) =>
      new WebHostRequestError({
        message: `Failed to stat local attachment preview: ${errorMessage(error)}`,
        status: 404,
      }),
  });

export const localAttachmentPreviewResponse = (
  request: Request,
  localAttachmentPort: ReturnType<typeof createLocalAttachmentAdapter>,
  corsHeaders: HeadersInit,
): Effect.Effect<Response, WebHostRequestError> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);
    const requestedPath = requestUrl.searchParams.get("path");
    if (!requestedPath) {
      return yield* rejectWebHostRequest("Local attachment preview path is required.", 400);
    }

    const canonicalDirectory = yield* localAttachmentPort
      .canonicalizePath(localAttachmentPort.stageDirectory())
      .pipe(
        Effect.mapError(
          (error) =>
            new WebHostRequestError({
              message: `Failed to resolve local attachment preview directory: ${errorMessage(error)}`,
              status: 500,
            }),
        ),
      );
    const canonicalPath = yield* localAttachmentPort.canonicalizePath(requestedPath).pipe(
      Effect.mapError(
        (error) =>
          new WebHostRequestError({
            message: `Failed to resolve local attachment preview path: ${errorMessage(error)}`,
            status: 500,
          }),
      ),
    );
    if (!isWithinDirectory(canonicalDirectory, canonicalPath)) {
      return yield* rejectWebHostRequest(
        "Local attachment preview is only available for staged attachment files.",
        403,
      );
    }

    const metadata = yield* statLocalAttachmentPreview(canonicalPath);
    if (!metadata.isFile()) {
      return yield* rejectWebHostRequest(
        "Local attachment preview path must reference a file",
        400,
      );
    }

    const file = nodeReadableStream(createReadStream(canonicalPath));
    return new Response(file, {
      headers: {
        ...corsHeaders,
        "cache-control": "no-store, private",
        "content-type": lookupMimeType(canonicalPath) || "application/octet-stream",
      },
    });
  });
