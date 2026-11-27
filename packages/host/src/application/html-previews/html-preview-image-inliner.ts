import {
  imagePreviewMime,
  ODT_HTML_PREVIEW_MAX_IMAGE_BYTES,
  ODT_HTML_PREVIEW_MAX_STORED_BYTES,
  odtHtmlPreviewByteSize,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import {
  CSS_COMMENT,
  HTML_START_TAG,
  HTML_STYLE_ELEMENT,
  maskHtmlNonMarkup,
  scanStartTagAttributes,
} from "./html-preview-validation";

const IMAGE_EXTENSIONS = "png|jpg|jpeg|gif|webp|avif|svg|bmp|ico";
const htmlPreviewImageMime = (extension: string): string | undefined =>
  extension.toLowerCase() === ".avif" ? "image/avif" : imagePreviewMime(extension);
const IMAGE_URL_CANDIDATE = new RegExp(
  String.raw`^(?:file://)?(?:/(?!/)|[a-z]:[\\/]).{0,2048}\.(?:${IMAGE_EXTENSIONS})$`,
  "i",
);
const CSS_URL = /url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^)\s"']+))\s*\)/dgi;
const IMAGE_TARGET_ATTRS = new Set(["src", "poster", "srcset", "style"]);
const utf8Decoder = new TextDecoder("utf-8");

const isExplicitLocalPath = (reference: string): boolean =>
  /^file:\/\//i.test(reference) || /^[a-z]:[\\/]/i.test(reference);

const NAMED_HTML_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const decodeHtmlEntities = (value: string): string => {
  if (!value.includes("&")) return value;
  return value.replaceAll(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));/gi, (match, hex, dec, named) => {
    if (named !== undefined) {
      return NAMED_HTML_ENTITIES.get(String(named).toLowerCase()) ?? match;
    }
    const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
    return String.fromCodePoint(codePoint);
  });
};

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

type LocalImageRef = { start: number; end: number; path: string };

const collectCssUrls = (
  html: string,
  segment: string,
  baseOffset: number,
  refs: LocalImageRef[],
  decodeEntities: boolean,
): void => {
  const withoutComments = segment.replaceAll(CSS_COMMENT, (match) => " ".repeat(match.length));
  for (const match of withoutComments.matchAll(CSS_URL)) {
    const span = match.indices?.[1] ?? match.indices?.[2] ?? match.indices?.[3];
    if (!span) continue;
    const start = baseOffset + span[0];
    const end = baseOffset + span[1];
    const rawValue = html.slice(start, end);
    const decoded = decodeEntities ? decodeHtmlEntities(rawValue) : rawValue;
    if (IMAGE_URL_CANDIDATE.test(decoded)) {
      refs.push({ start, end, path: decoded });
    }
  }
};

const collectSrcsetUrls = (
  html: string,
  segment: string,
  baseOffset: number,
  refs: LocalImageRef[],
): void => {
  let cursor = 0;
  for (const part of segment.split(",")) {
    const trimmedLeading = part.length - part.trimStart().length;
    const body = part.trimStart();
    const urlEnd = body.search(/\s/);
    const rawUrl = urlEnd === -1 ? body : body.slice(0, urlEnd);
    const decoded = decodeHtmlEntities(rawUrl);
    if (decoded.length > 0 && IMAGE_URL_CANDIDATE.test(decoded)) {
      const start = baseOffset + cursor + trimmedLeading;
      refs.push({ start, end: start + rawUrl.length, path: decoded });
    }
    cursor += part.length + 1;
  }
};

/**
 * Scans only real image-bearing HTML attributes (`src`, `poster`, `srcset`, `style`) and `<style>`
 * CSS `url(...)` values outside comments, scripts, textareas, and templates.
 */
const findLocalImageRefsInMarkup = (html: string): LocalImageRef[] => {
  const masked = maskHtmlNonMarkup(html);
  const refs: LocalImageRef[] = [];

  for (const styleMatch of masked.matchAll(HTML_STYLE_ELEMENT)) {
    const bodySpan = styleMatch.indices?.[1];
    if (bodySpan) {
      collectCssUrls(html, masked.slice(bodySpan[0], bodySpan[1]), bodySpan[0], refs, false);
    }
  }

  const tagsOnly = masked.replaceAll(HTML_STYLE_ELEMENT, (match) => " ".repeat(match.length));
  for (const tagMatch of tagsOnly.matchAll(HTML_START_TAG)) {
    const tagSpan = tagMatch.indices?.[0];
    if (!tagSpan) continue;
    for (const attribute of scanStartTagAttributes(tagMatch[0], tagSpan[0])) {
      if (!IMAGE_TARGET_ATTRS.has(attribute.name)) continue;
      const rawValue = html.slice(attribute.valueStart, attribute.valueEnd);
      if (attribute.name === "style") {
        collectCssUrls(html, rawValue, attribute.valueStart, refs, true);
      } else if (attribute.name === "srcset") {
        collectSrcsetUrls(html, rawValue, attribute.valueStart, refs);
      } else {
        const decoded = decodeHtmlEntities(rawValue);
        if (IMAGE_URL_CANDIDATE.test(decoded)) {
          refs.push({ start: attribute.valueStart, end: attribute.valueEnd, path: decoded });
        }
      }
    }
  }

  refs.sort((left, right) => left.start - right.start);
  return refs;
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
): Effect.Effect<string, HostValidationError> =>
  Effect.gen(function* () {
    const refs = findLocalImageRefsInMarkup(html);
    if (refs.length === 0) return html;

    const occurrenceCounts = new Map<string, number>();
    for (const ref of refs) {
      occurrenceCounts.set(ref.path, (occurrenceCounts.get(ref.path) ?? 0) + 1);
    }

    let projectedBytes = odtHtmlPreviewByteSize(html);
    const sizeLimitExceeded = (): HostValidationError =>
      new HostValidationError({
        field: "html",
        message: `Inlining local images would exceed the ${formatMib(ODT_HTML_PREVIEW_MAX_STORED_BYTES)} preview size limit. Resize or compress the images and retry.`,
      });

    const prepareOne = (refPath: string): Effect.Effect<PreparedLocalImage, HostValidationError> =>
      Effect.gen(function* () {
        if (projectedBytes > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
          return yield* sizeLimitExceeded();
        }

        const opened = yield* filePort.readLocalImage(
          refPath,
          allowedRoots,
          ODT_HTML_PREVIEW_MAX_IMAGE_BYTES,
        );
        if (opened.kind === "blocked") {
          return { kind: "invalid", refPath };
        }
        if (opened.kind === "outside_allowed") {
          // Leave root-relative web URLs (such as `/favicon.ico` or `/logo.png`) untouched; only
          // fail explicit local `file://` or Windows drive paths that escape the allowed roots.
          return isExplicitLocalPath(refPath) ? { kind: "invalid", refPath } : { kind: "skip" };
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

        if (!isImageBytes(opened.bytes, opened.extension)) {
          return yield* new HostValidationError({
            field: "html",
            message: `Local image '${refPath}' does not match a valid image format.`,
          });
        }

        const mimeType = htmlPreviewImageMime(opened.extension) ?? "application/octet-stream";
        const occurrences = occurrenceCounts.get(refPath) ?? 0;
        const deltaBytes =
          occurrences *
          (encodedDataUriByteLength(mimeType, opened.size) - odtHtmlPreviewByteSize(refPath));
        projectedBytes += deltaBytes;
        if (projectedBytes > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
          return yield* sizeLimitExceeded();
        }

        return {
          kind: "ok",
          refPath,
          dataUri: `data:${mimeType};base64,${bytesToBase64(opened.bytes)}`,
        };
      });

    const prepared = yield* Effect.forEach([...occurrenceCounts.keys()], prepareOne, {
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
      const replacement = dataUris.get(ref.path);
      if (replacement === undefined) continue;
      chunks.push(html.slice(cursor, ref.start), replacement);
      cursor = ref.end;
    }
    chunks.push(html.slice(cursor));
    return chunks.join("");
  });
