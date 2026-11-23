// Mask HTML comments, raw-text elements, and templates without shifting offsets so scans only
// inspect real stylesheets and attributes inside HTML start tags.
const NON_MARKUP_BLOCK =
  /<!--[\s\S]*?(?:-->|$)|<(script|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi;
export const HTML_STYLE_ELEMENT = /<style\b[^>]*(?:>|$)([\s\S]*?)(?:<\/style\s*>|$)/dgi;
export const HTML_START_TAG = /<[a-z][a-z0-9:-]*(?:\s+(?:[^"'>]|"[^"]*"|'[^']*')*)?>/dgi;
export const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
// The lookbehind skips base64 runs, such as an inlined image that happens to contain "1vh".
const VIEWPORT_HEIGHT_UNIT = /(?<![\w.+/])(?:\d+(?:\.\d+)?|\.\d+)[sld]?vh(?![\w-])/i;
// Matches Tailwind viewport-height utilities like min-h-screen, h-dvh, md:h-[80vh], !min-h-svh.
const TAILWIND_VIEWPORT_HEIGHT_CLASS =
  /(?:^|\s)(?:[a-z0-9-[\]]+:)*!?(?:min-h|max-h|h)-(?:screen|[sld]?vh|\[[^\]]*(?:\d|\.)[sld]?vh[^\]]*\])(?=$|\s)/i;

export type HtmlTagAttribute = {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
};

export const maskHtmlNonMarkup = (html: string): string => {
  const masked = html.replaceAll(NON_MARKUP_BLOCK, (match) => " ".repeat(match.length));
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let at = 0;
  for (const match of masked.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!match[1]) {
      if (depth++ === 0) start = match.index;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + match[0].length;
      parts.push(masked.slice(at, start), " ".repeat(end - start));
      at = end;
    }
  }
  if (depth > 0) {
    parts.push(masked.slice(at, start), " ".repeat(masked.length - start));
    at = masked.length;
  }
  parts.push(masked.slice(at));
  return parts.join("");
};

/**
 * Parses attributes of one HTML start tag sequentially so quoted values of other attributes cannot
 * match as target attributes and valid adjacent HTML5 attributes (`alt="x"src="..."`) are read.
 */
export const scanStartTagAttributes = (tag: string, tagOffset = 0): HtmlTagAttribute[] => {
  const attributes: HtmlTagAttribute[] = [];
  let cursor = 1;
  while (cursor < tag.length && !/[\s/>]/.test(tag.charAt(cursor))) cursor += 1;

  while (cursor < tag.length) {
    while (cursor < tag.length && /[\s/]/.test(tag.charAt(cursor))) cursor += 1;
    if (cursor >= tag.length || tag.charAt(cursor) === ">") break;

    const nameStart = cursor;
    while (cursor < tag.length && !/[\s=/>"']/.test(tag.charAt(cursor))) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = tag.slice(nameStart, cursor).toLowerCase();

    while (cursor < tag.length && /\s/.test(tag.charAt(cursor))) cursor += 1;
    if (tag.charAt(cursor) !== "=") continue;
    cursor += 1;
    while (cursor < tag.length && /\s/.test(tag.charAt(cursor))) cursor += 1;

    const quote = tag.charAt(cursor);
    let valueStart: number;
    let valueEnd: number;
    if (quote === '"' || quote === "'") {
      cursor += 1;
      valueStart = cursor;
      const closeIndex = tag.indexOf(quote, cursor);
      valueEnd = closeIndex === -1 ? tag.length : closeIndex;
      cursor = closeIndex === -1 ? tag.length : closeIndex + 1;
    } else {
      valueStart = cursor;
      while (cursor < tag.length && !/[\s>]/.test(tag.charAt(cursor))) cursor += 1;
      valueEnd = cursor;
    }

    attributes.push({
      name,
      value: tag.slice(valueStart, valueEnd),
      valueStart: tagOffset + valueStart,
      valueEnd: tagOffset + valueEnd,
    });
  }

  return attributes;
};

/**
 * The first viewport height CSS unit or Tailwind viewport-height utility class in the document,
 * or `undefined` when the page has none. Skips comments, scripts, templates, and plain text.
 */
export const findHtmlPreviewViewportHeight = (html: string): string | undefined => {
  const masked = maskHtmlNonMarkup(html);

  for (const match of masked.matchAll(HTML_STYLE_ELEMENT)) {
    const css = (match[1] ?? "").replace(CSS_COMMENT, "");
    const found = VIEWPORT_HEIGHT_UNIT.exec(css)?.[0];
    if (found !== undefined) return found;
  }

  // Mask <style> bodies before scanning start tags so CSS content cannot look like HTML tags.
  const tagsOnly = masked.replaceAll(HTML_STYLE_ELEMENT, (match) => " ".repeat(match.length));
  for (const tagMatch of tagsOnly.matchAll(HTML_START_TAG)) {
    for (const attribute of scanStartTagAttributes(tagMatch[0])) {
      if (attribute.name === "style") {
        const css = attribute.value.replace(CSS_COMMENT, "");
        const found = VIEWPORT_HEIGHT_UNIT.exec(css)?.[0];
        if (found !== undefined) return found;
      } else if (attribute.name === "class") {
        const found = TAILWIND_VIEWPORT_HEIGHT_CLASS.exec(attribute.value)?.[0]?.trim();
        if (found !== undefined) return found;
      }
    }
  }

  return undefined;
};
