import { tokenizer, TokenType } from "@csstools/css-tokenizer";
import { imagePreviewMime } from "@openducktor/contracts";
import { decodeHTMLAttribute, DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import {
  HTML_START_TAG,
  HTML_STYLE_ELEMENT,
  maskHtmlNonMarkup,
  scanStartTagAttributes,
} from "./html-preview-validation";

const ABSOLUTE_PATH = /^(?:file:\/\/)?(?:\/(?!\/)|[a-z]:[\\/]).{0,2048}$/i;
const SCHEME_ROOT_OR_FRAGMENT = /^(?:[a-z][a-z\d+.-]*:|[/#])/i;
const UNRESOLVED_IMAGE_SUFFIX = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:[?#].*)?$/i;
const IMAGE_ATTRIBUTES = new Set(["src", "poster", "srcset", "style"]);

type SourceSpan = { start: number; end: number; value: string };
type ImageFile = { filePath: string; extension: string; fragment: string; mimeType: string };

export type LocalImageReference = {
  start: number;
  end: number;
  reference: string;
  relative: boolean;
  file: ImageFile | undefined;
};

type DecodedAttribute = { text: string; sourceOffset: (offset: number) => number };

const decodeAttributeWithOffsets = (source: string): DecodedAttribute => {
  const firstEntity = source.indexOf("&");
  if (firstEntity === -1) return { text: source, sourceOffset: (offset) => offset };

  const changes: { decodedEnd: number; removed: number }[] = [];
  let text = "";
  let cursor = 0;
  let decodedEntity = "";
  const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
    decodedEntity += String.fromCodePoint(codePoint);
  });
  for (let start = firstEntity; start !== -1; start = source.indexOf("&", start + 1)) {
    decodedEntity = "";
    decoder.startEntity(DecodingMode.Attribute);
    const consumed = decoder.write(source, start + 1);
    const length = consumed === -1 ? decoder.end() : consumed;
    if (length === 0) continue;

    text += source.slice(cursor, start) + decodedEntity;
    cursor = start + length;
    changes.push({ decodedEnd: text.length, removed: cursor - text.length });
    start = cursor - 1;
  }

  return {
    text: text + source.slice(cursor),
    sourceOffset: (offset) => {
      let low = 0;
      let high = changes.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if ((changes[mid]?.decodedEnd ?? Infinity) <= offset) low = mid + 1;
        else high = mid;
      }
      return offset + (changes[low - 1]?.removed ?? 0);
    },
  };
};

const scanCssUrls = (css: string, collect: (span: SourceSpan) => void): void => {
  const lexer = tokenizer({ css });
  let quotedUrl: SourceSpan | null | undefined;
  for (let token = lexer.nextToken(); token[0] !== TokenType.EOF; token = lexer.nextToken()) {
    if (token[0] === TokenType.Whitespace || token[0] === TokenType.Comment) continue;
    const raw = token[1];
    const start = token[2];
    if (quotedUrl === null && token[0] === TokenType.String && raw.endsWith(raw[0] ?? "")) {
      quotedUrl = { start: start + 1, end: token[3], value: token[4].value };
      continue;
    }
    if (quotedUrl && token[0] === TokenType.CloseParen) collect(quotedUrl);
    quotedUrl = undefined;

    if (token[0] === TokenType.URL && raw.endsWith(")")) {
      const bodyOffset = raw.indexOf("(") + 1;
      const body = raw.slice(bodyOffset, -1);
      collect({
        start: start + bodyOffset + body.length - body.trimStart().length,
        end: start + bodyOffset + body.trimEnd().length,
        value: token[4].value,
      });
    } else if (token[0] === TokenType.Function && token[4].value.toLowerCase() === "url") {
      quotedUrl = null;
    }
  }
};

const scanSrcset = (text: string, collect: (span: SourceSpan) => void): void => {
  const urls = /[^,\t\n\f\r ][^\t\n\f\r ]*/g;
  for (let match = urls.exec(text); match; match = urls.exec(text)) {
    const token = match[0];
    const value = token.replace(/,+$/, "");
    const start = match.index;
    collect({ start, end: start + value.length, value });
    // Skip descriptors after the URL, never commas within the URL.
    if (value.length !== token.length) continue;
    const comma = text.indexOf(",", urls.lastIndex);
    if (comma === -1) break;
    urls.lastIndex = comma + 1;
  }
};

export const scanLocalImageReferences = (
  html: string,
  resolveLocalImage: HtmlPreviewFilePort["resolveLocalImage"],
  baseDir?: string,
): LocalImageReference[] => {
  const masked = maskHtmlNonMarkup(html);
  const refs: LocalImageReference[] = [];
  let hasHttpsBase: boolean | undefined;

  const collect = ({ start, end, value }: SourceSpan, imageSource = false): void => {
    const reference = value.trim();
    if (reference === "") return;
    const relative = !SCHEME_ROOT_OR_FRAGMENT.test(reference);
    if (!relative && !ABSOLUTE_PATH.test(reference)) return;
    const resolved = resolveLocalImage(reference, relative, baseDir);
    const mimeType =
      resolved?.extension === ".avif" ? "image/avif" : imagePreviewMime(resolved?.extension ?? "");
    if (
      !mimeType &&
      !(relative && imageSource) &&
      !(resolved === null && UNRESOLVED_IMAGE_SUFFIX.test(reference))
    ) {
      return;
    }
    const file =
      resolved?.filePath !== undefined && mimeType
        ? {
            filePath: resolved.filePath,
            extension: resolved.extension,
            fragment: resolved.fragment,
            mimeType,
          }
        : undefined;
    refs.push({ start, end, reference, relative, file });
  };

  for (const styleMatch of masked.matchAll(HTML_STYLE_ELEMENT)) {
    const bodySpan = styleMatch.indices?.[1];
    if (!bodySpan) continue;
    const [start, end] = bodySpan;
    scanCssUrls(html.slice(start, end), (span) =>
      collect({ ...span, start: start + span.start, end: start + span.end }),
    );
  }

  const tagsOnly = masked.replaceAll(HTML_STYLE_ELEMENT, (match) => " ".repeat(match.length));
  for (const tagMatch of tagsOnly.matchAll(HTML_START_TAG)) {
    const tag = tagMatch[0];
    const attributes = scanStartTagAttributes(tag, tagMatch.index);
    if (hasHttpsBase === undefined && /^<base[\s>]/i.test(tag)) {
      const href = attributes.find(({ name }) => name === "href");
      if (href) {
        hasHttpsBase =
          URL.parse(decodeHTMLAttribute(html.slice(href.valueStart, href.valueEnd)))?.protocol ===
          "https:";
      }
    }

    for (const { name, valueStart, valueEnd } of attributes) {
      if (!IMAGE_ATTRIBUTES.has(name)) continue;
      const value = html.slice(valueStart, valueEnd);
      if (name === "style" || name === "srcset") {
        const { text, sourceOffset } = decodeAttributeWithOffsets(value);
        const scan = name === "style" ? scanCssUrls : scanSrcset;
        scan(text, ({ start, end, value }) =>
          collect({
            start: valueStart + sourceOffset(start),
            end: valueStart + sourceOffset(end),
            value,
          }),
        );
      } else {
        collect(
          { start: valueStart, end: valueEnd, value: decodeHTMLAttribute(value) },
          name === "src" && /^<img[\s>]/i.test(tag),
        );
      }
    }
  }

  refs.sort((left, right) => left.start - right.start);
  return hasHttpsBase ? refs.filter((ref) => !ref.relative) : refs;
};
