import {
  ODT_HTML_PREVIEW_MAX_IMAGE_BYTES,
  ODT_HTML_PREVIEW_MAX_STORED_BYTES,
  odtHtmlPreviewByteSize,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import {
  type LocalImageReference,
  scanLocalImageReferences,
} from "./html-preview-image-references";

const utf8Decoder = new TextDecoder("utf-8");

const isExplicitLocalPath = (reference: string): boolean =>
  /^file:\/\//i.test(reference) || /^[a-z]:[\\/]/i.test(reference);

const formatMib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(parts.join(""));
};

const after = (text: string, token: string, from: number): number => {
  const at = text.indexOf(token, from);
  return at === -1 ? -1 : at + token.length;
};

const afterDoctype = (text: string, from: number): number => {
  let inSubset = false;
  let at = from;
  while (at !== -1 && at < text.length) {
    const char = text[at];
    if (char === '"' || char === "'") at = after(text, char, at + 1);
    else if (inSubset && text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (inSubset && text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (char === ">" && !inSubset) return at + 1;
    else {
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      at += 1;
    }
  }
  return -1;
};

const hasSvgRoot = (text: string): boolean => {
  let at = 0;
  while (at !== -1 && at < text.length) {
    while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (text.slice(at, at + 9).toLowerCase() === "<!doctype") at = afterDoctype(text, at + 9);
    else return /^<svg[ \t\r\n/>]/.test(text.slice(at, at + 5));
  }
  return false;
};

const hasAsciiAt = (bytes: Uint8Array, offset: number, ascii: string): boolean => {
  if (bytes.length < offset + ascii.length) return false;
  for (let index = 0; index < ascii.length; index += 1) {
    if (bytes[offset + index] !== ascii.charCodeAt(index)) return false;
  }
  return true;
};

const isImageBytes = (bytes: Uint8Array, ext: string): boolean => {
  if (ext === ".svg") {
    return hasSvgRoot(utf8Decoder.decode(bytes.subarray(0, 4096)));
  }
  const isPng =
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isGif = hasAsciiAt(bytes, 0, "GIF8");
  const isIco =
    bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  const isBmp =
    hasAsciiAt(bytes, 0, "BM") &&
    bytes.length >= 10 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0;
  const isWebp = hasAsciiAt(bytes, 0, "RIFF") && hasAsciiAt(bytes, 8, "WEBP");
  const isAvif =
    hasAsciiAt(bytes, 4, "ftyp") &&
    (hasAsciiAt(bytes, 8, "avif") || hasAsciiAt(bytes, 8, "avis") || hasAsciiAt(bytes, 8, "mif1"));
  return isPng || isJpeg || isGif || isIco || isBmp || isWebp || isAvif;
};

type LocalImageUses = Pick<LocalImageReference, "file" | "relative"> & {
  count: number;
  replacedBytes: number;
};

type PreparedLocalImage =
  | { kind: "skip" }
  | { kind: "ok"; refPath: string; dataUri: string }
  | { kind: "invalid"; refPath: string };

const encodedDataUriByteLength = (mimeType: string, rawByteLength: number): number =>
  odtHtmlPreviewByteSize(`data:${mimeType};base64,`) + Math.ceil(rawByteLength / 3) * 4;

/**
 * Validates and inlines referenced local images into `data:` URIs while enforcing both the per-image
 * cap and the total stored preview byte cap before encoding additional files.
 */
export const inlineLocalHtmlPreviewImages = (
  html: string,
  allowedRoots: readonly string[],
  filePort: HtmlPreviewFilePort,
  baseDir?: string,
): Effect.Effect<string, HostValidationError> =>
  Effect.gen(function* () {
    const refs = scanLocalImageReferences(html, filePort.resolveLocalImage, baseDir);
    if (refs.length === 0) return html;

    const images = new Map<string, LocalImageUses>();
    // Count the unchanged HTML first. Each image can then only add bytes to the preview.
    let projectedBytes = odtHtmlPreviewByteSize(html);
    for (const { start, end, reference, relative, file } of refs) {
      const replacedBytes = odtHtmlPreviewByteSize(html.slice(start, end));
      projectedBytes -= replacedBytes;
      const image = images.get(reference);
      if (image) {
        image.count += 1;
        image.replacedBytes += replacedBytes;
      } else {
        images.set(reference, { count: 1, relative, file, replacedBytes });
      }
    }

    if (baseDir === undefined) {
      const relativePaths = [...images].filter(([, image]) => image.relative).map(([path]) => path);
      if (relativePaths.length > 0) {
        return yield* new HostValidationError({
          field: "html",
          message: `Relative image paths: ${relativePaths.join(", ")}. Set baseDir to their directory, or use absolute paths, data URIs, or HTTPS URLs.`,
        });
      }
    }

    const sizeLimitExceeded = (): HostValidationError =>
      new HostValidationError({
        field: "html",
        message: `Inlining local images would exceed the ${formatMib(ODT_HTML_PREVIEW_MAX_STORED_BYTES)} preview size limit. Resize or compress the images and retry.`,
      });

    const prepareOne = ([refPath, { count, file, relative, replacedBytes }]: [
      string,
      LocalImageUses,
    ]): Effect.Effect<PreparedLocalImage, HostValidationError> =>
      Effect.gen(function* () {
        if (projectedBytes > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
          return yield* sizeLimitExceeded();
        }

        if (!file) {
          return { kind: "invalid", refPath };
        }
        const opened = yield* filePort.readLocalImage(
          file.filePath,
          allowedRoots,
          ODT_HTML_PREVIEW_MAX_IMAGE_BYTES,
        );
        // An absolute slash path outside the allowed roots can be a root-relative HTTPS URL.
        if (opened.kind === "outside_allowed" && !relative && !isExplicitLocalPath(refPath)) {
          projectedBytes += replacedBytes;
          if (projectedBytes > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
            return yield* sizeLimitExceeded();
          }
          return { kind: "skip" };
        }
        if (opened.kind === "too_large") {
          return yield* new HostValidationError({
            field: "html",
            message: `Local image '${refPath}' is ${formatMib(opened.size)}; each local image must be at most ${formatMib(ODT_HTML_PREVIEW_MAX_IMAGE_BYTES)}.`,
          });
        }
        if (opened.kind !== "ok") {
          return { kind: "invalid", refPath };
        }

        if (!isImageBytes(opened.bytes, file.extension)) {
          return yield* new HostValidationError({
            field: "html",
            message: `Local image '${refPath}' does not match a valid image format.`,
          });
        }

        const { mimeType, fragment } = file;
        const replacementBytes =
          encodedDataUriByteLength(mimeType, opened.size) + odtHtmlPreviewByteSize(fragment);
        projectedBytes += count * replacementBytes;
        if (projectedBytes > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
          return yield* sizeLimitExceeded();
        }

        return {
          kind: "ok",
          refPath,
          dataUri: `data:${mimeType};base64,${bytesToBase64(opened.bytes)}${fragment}`,
        };
      });

    const prepared = yield* Effect.forEach(images, prepareOne, {
      concurrency: 8,
    });

    const dataUris = new Map<string, string>();
    const invalidImages: string[] = [];
    for (const item of prepared) {
      if (item.kind === "skip") continue;
      if (item.kind === "invalid") {
        invalidImages.push(item.refPath);
        continue;
      }
      dataUris.set(item.refPath, item.dataUri);
    }

    if (invalidImages.length > 0) {
      return yield* new HostValidationError({
        field: "html",
        message: `Could not inline local image(s): ${invalidImages.join(", ")}. Make sure each referenced path points to a readable image file inside the workspace, worktree, or temporary directory, or use an HTTPS URL or data: URI.`,
      });
    }

    if (dataUris.size === 0) return html;

    const chunks: string[] = [];
    let cursor = 0;
    for (const ref of refs) {
      const replacement = dataUris.get(ref.reference);
      if (replacement === undefined) continue;
      chunks.push(html.slice(cursor, ref.start), replacement);
      cursor = ref.end;
    }
    chunks.push(html.slice(cursor));
    return chunks.join("");
  });
