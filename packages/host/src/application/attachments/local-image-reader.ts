import {
  LOCAL_IMAGE_MAX_BYTES,
  type LocalImageReadInput,
  type LocalImageReadResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostOperationErrorAggregate,
  type HostPathAccessErrorAggregate,
  type HostPathNotFoundErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { LocalAttachmentPort } from "../../ports/local-attachment-port";

const mediaTypeOf = (path: string): LocalImageReadResult["mediaType"] | null => {
  switch (/\.[^./\\]+$/.exec(path)?.[0].toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
};

const invalidImage = (path: string, message: string) =>
  new HostValidationError({ message, details: { field: "path", path } });

/**
 * Reads an image file of the host, such as an agent screenshot that a chat reply shows. Any
 * absolute path works. Only PNG, JPEG, GIF, and WebP files up to the size limit load.
 */
export const readLocalImage = (
  port: Pick<LocalAttachmentPort, "isAbsolutePath" | "fileInfo" | "readFile">,
  { path }: LocalImageReadInput,
): Effect.Effect<
  LocalImageReadResult,
  | HostValidationErrorAggregate
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostPathNotFoundErrorAggregate
> =>
  Effect.gen(function* () {
    if (!port.isAbsolutePath(path)) {
      return yield* invalidImage(path, `Use an absolute path to show the image ${path}.`);
    }
    const mediaType = mediaTypeOf(path);
    if (mediaType === null) {
      return yield* invalidImage(path, `${path} is not a PNG, JPEG, GIF, or WebP image.`);
    }
    const info = yield* port.fileInfo(path);
    if (!info.isFile) {
      return yield* invalidImage(path, `${path} is not a file.`);
    }
    if (info.byteSize > LOCAL_IMAGE_MAX_BYTES) {
      return yield* invalidImage(
        path,
        `${path} is larger than ${LOCAL_IMAGE_MAX_BYTES / (1024 * 1024)} MB, so the app does not show it.`,
      );
    }
    const bytes = yield* port.readFile(path);
    return { mediaType, bytesBase64: Buffer.from(bytes).toString("base64") };
  });
