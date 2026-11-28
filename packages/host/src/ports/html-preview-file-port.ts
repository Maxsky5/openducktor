import type { Effect } from "effect";
import type { HostValidationError } from "../effect/host-errors";

type ReadLocalPreviewImageResult =
  | { kind: "ok"; bytes: Uint8Array; size: number }
  | { kind: "too_large"; size: number }
  | { kind: "outside_allowed" }
  | { kind: "blocked" }
  | { kind: "invalid" };

export type LocalPreviewImageReference = {
  filePath: string | undefined;
  extension: string;
  fragment: string;
};

/** Reads local HTML preview files and referenced local image bytes within allowed roots. */
export type HtmlPreviewFilePort = {
  readHtmlFile(
    filePath: string,
    allowedRoots: readonly string[],
  ): Effect.Effect<{ html: string; baseDir: string }, HostValidationError>;
  validateImageBaseDir(
    baseDir: string,
    allowedRoots: readonly string[],
  ): Effect.Effect<void, HostValidationError>;
  resolveLocalImage(
    reference: string,
    relative: boolean,
    baseDir?: string,
  ): LocalPreviewImageReference | null;
  readLocalImage(
    filePath: string,
    allowedRoots: readonly string[],
    maxBytes: number,
  ): Effect.Effect<ReadLocalPreviewImageResult>;
};
