import {
  HTML_PREVIEW_ESCAPE_MESSAGE,
  HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  HTML_PREVIEW_OPEN_LINK_MESSAGE,
  HTML_PREVIEW_RESIZE_MESSAGE,
  HTML_PREVIEW_THEME_MESSAGE,
} from "@openducktor/contracts";

/** The theme values that a published page inherits from the app. */
export type HtmlPreviewThemeSheet = {
  appearance: "light" | "dark";
  variables: Readonly<Record<string, string>>;
  fontSans: string;
  fontMono: string;
  /** The corner radius of the app, such as `0.75rem`. */
  radius?: string;
};

/** The app surface that a preview viewer paints before the page loads. */
export type HtmlPreviewSurface = {
  appearance: "light" | "dark";
  /** The transcript surface color. */
  background: string;
};

const cleanCssValue = (value: string): string => value.replaceAll(/[;{}<>]/g, "").trim();

/**
 * The trusted theme sheet of a published page. The page starts on the transcript surface with the
 * app text color and font stacks, so an unstyled page has no seam with the transcript. Authored
 * styles come later in the document and win over these defaults.
 */
export function buildHtmlPreviewThemeSheet({
  appearance,
  variables,
  fontSans,
  fontMono,
  radius,
}: HtmlPreviewThemeSheet): string {
  const declarations = Object.entries(variables).flatMap(([name, value]) => {
    if (!/^--[a-z0-9-]+$/.test(name)) return [];
    const cleaned = cleanCssValue(value);
    return cleaned.length === 0 ? [] : [`${name}:${cleaned}`];
  });
  const base = [
    `--font-sans:${cleanCssValue(fontSans)}`,
    `--font-mono:${cleanCssValue(fontMono)}`,
    ...declarations,
  ];
  if (radius !== undefined) base.push(`--radius:${cleanCssValue(radius)}`);
  // No overscroll containment: a page that is not scrollable must let the wheel reach the
  // transcript, and a page that is scrollable must pass the wheel on at its end.
  return `:root{color-scheme:${appearance};${base.join(";")}}html{background:var(--chat-background,var(--background));color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}:where(:focus-visible){outline:2px solid var(--ring)}:focus-visible{outline-width:2px!important;outline-offset:-2px!important}`;
}

type HtmlPreviewDocumentOptions = {
  /** Keeps the page's `scrollIntoView` calls inside the page and clips vertical overflow until max height. */
  containScroll?: boolean;
  /** Forwards trusted Escape key presses (outside editable inputs) to close full-screen modals. */
  forwardEscape?: boolean;
  /** Maximum inline height before switching root vertical overflow to `auto`. */
  maxContentHeight?: number;
  /**
   * Whether vertical scrolling turns on inside the page once content exceeds `maxContentHeight`.
   * Mobile inline previews disable this so iOS WKWebView never traps vertical transcript swipes in
   * an inner iframe scroll view; full screen handles vertical scrolling instead.
   */
  allowVerticalScrollAtMaxHeight?: boolean;
};

/**
 * The trusted additions before the authored markup: document metadata that a page often omits,
 * the theme defaults, and the reporter for the inline frame. Authored styles come later and win.
 * The source view shows the original HTML without these additions.
 */
export function buildHtmlPreviewDocument(
  html: string,
  themeCss: string,
  {
    containScroll = false,
    forwardEscape = false,
    maxContentHeight = HTML_PREVIEW_MAX_CONTENT_HEIGHT,
    allowVerticalScrollAtMaxHeight = true,
  }: HtmlPreviewDocumentOptions = {},
): string {
  const additions = `${documentMeta(html)}<style data-odt-html-preview="">${themeCss}</style>${buildPageScript(
    {
      containScroll,
      forwardEscape,
      maxContentHeight,
      allowVerticalScrollAtMaxHeight,
    },
  )}`;
  const insertion = findInsertionPoint(html);
  if (insertion.kind === "head") {
    return html.slice(0, insertion.at) + additions + html.slice(insertion.at);
  }
  const head = `<head>${additions}</head>`;
  if (insertion.kind === "html" || insertion.kind === "doctype") {
    return html.slice(0, insertion.at) + head + html.slice(insertion.at);
  }
  return head + html;
}

const documentMeta = (html: string): string => {
  const hasCharset = /<meta\s[^>]*charset\s*=/i.test(html.slice(0, 4096));
  const hasViewport = /<meta\s[^>]*name\s*=\s*["']?viewport\b/i.test(html);
  return `${hasCharset ? "" : '<meta charset="utf-8">'}${
    hasViewport ? "" : '<meta name="viewport" content="width=device-width, initial-scale=1">'
  }`;
};

type InsertionPoint =
  | { kind: "head"; at: number }
  | { kind: "html"; at: number }
  | { kind: "doctype"; at: number }
  | { kind: "start" };

/**
 * Finds the first real `head`, `html`, or doctype start. Comments and the contents of raw-text
 * elements are masked first, so a `<head>` inside a script string cannot take the theme and
 * reporter into the script. Template contents are masked too, including nested templates.
 */
function findInsertionPoint(html: string): InsertionPoint {
  const scan = maskNonMarkup(html);
  const head = /<head(?:\s(?:[^"'>]|"[^"]*"|'[^']*')*)?>/i.exec(scan);
  if (head) return { kind: "head", at: head.index + head[0].length };
  const root = /<html(?:\s(?:[^"'>]|"[^"]*"|'[^']*')*)?>/i.exec(scan);
  if (root) return { kind: "html", at: root.index + root[0].length };
  const doctype = /^\s*<!doctype[^>]*>/i.exec(scan);
  if (doctype) return { kind: "doctype", at: doctype.index + doctype[0].length };
  return { kind: "start" };
}

const maskNonMarkup = (html: string): string => {
  const masked = html.replaceAll(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (match) => " ".repeat(match.length),
  );
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

// Native scrollIntoView scrolls every scroller outside a framed page, which would move the chat
// around an inline preview. This override scrolls the scrollers inside the page and then the
// page's own viewport, and stops there. It follows T3Code's inline page behavior.
const CONTAINED_SCROLL_INTO_VIEW = `
Element.prototype.scrollIntoView = function (arg) {
  var options =
    arg !== null && (typeof arg === "object" || typeof arg === "function")
      ? arg
      : { block: arg === undefined || arg === null || arg ? "start" : "end" };
  var block = options.block || "start";
  var inline = options.inline || "nearest";
  var behavior = options.behavior || "auto";
  var px = function (value) { return parseFloat(value) || 0; };
  var selfStyle = getComputedStyle(this);
  var rect = this.getBoundingClientRect();
  var targetTop = rect.top - px(selfStyle.scrollMarginTop);
  var targetBottom = rect.bottom + px(selfStyle.scrollMarginBottom);
  var targetLeft = rect.left - px(selfStyle.scrollMarginLeft);
  var targetRight = rect.right + px(selfStyle.scrollMarginRight);
  var scrolledX = 0;
  var scrolledY = 0;
  var node = this;
  var isFixed = selfStyle.position === "fixed";

  var axisDelta = function (start, end, low, high, align) {
    var larger = end - start > high - low;
    if (align === "start") return start - low;
    if (align === "end") return end - high;
    if (align === "center") return (start + end - low - high) / 2;
    if (start < low && end > high) return 0;
    if (start < low) return larger ? end - high : start - low;
    if (end > high) return larger ? start - low : end - high;
    return 0;
  };

  var scrollBox = function (boxTop, boxLeft, scroller, style, performScroll) {
    var pad = function (edge) { return px(style["scrollPadding" + edge]); };
    var minLeft = style.direction === "rtl" ? scroller.clientWidth - scroller.scrollWidth : 0;
    var dy = axisDelta(
      targetTop - scrolledY,
      targetBottom - scrolledY,
      boxTop + pad("Top"),
      boxTop + scroller.clientHeight - pad("Bottom"),
      block
    );
    var dx = axisDelta(
      targetLeft - scrolledX,
      targetRight - scrolledX,
      boxLeft + pad("Left"),
      boxLeft + scroller.clientWidth - pad("Right"),
      inline
    );
    dy = Math.max(-scroller.scrollTop, Math.min(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop, dy));
    dx = Math.max(minLeft - scroller.scrollLeft, Math.min(minLeft + scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft, dx));
    if (dx || dy) performScroll({ left: dx, top: dy, behavior: behavior });
    scrolledX += dx;
    scrolledY += dy;
  };

  var viewport = document.scrollingElement || document.documentElement;
  while (!isFixed) {
    node = node.parentElement || (node.getRootNode && node.getRootNode().host);
    if (!node) break;
    if (node === viewport || node === document.documentElement) continue;
    var rootStyle = getComputedStyle(document.documentElement);
    var nodeStyle = getComputedStyle(node);
    var nodeRect = node.getBoundingClientRect();
    if (node === document.body && rootStyle.overflowX + rootStyle.overflowY === "visiblevisible") continue;
    if (/auto|scroll|hidden/.test(nodeStyle.overflowX + nodeStyle.overflowY)) {
      scrollBox(nodeRect.top + node.clientTop, nodeRect.left + node.clientLeft, node, nodeStyle, node.scrollBy.bind(node));
    }
    isFixed = nodeStyle.position === "fixed";
  }
  if (!isFixed) {
    scrollBox(0, 0, viewport, getComputedStyle(viewport), window.scrollBy.bind(window));
  }
};
`;

const LINK_INTERCEPT_SCRIPT = `
addEventListener("click", function (event) {
  if (!event.isTrusted || event.defaultPrevented || event.button !== 0) return;
  var target = event.target;
  if (!target || typeof target.closest !== "function") return;
  var link = target.closest("a[href]");
  if (!link) return;
  var raw = link.getAttribute("href");
  if (!raw || raw.charAt(0) === "#") return;
  try {
    var url = new URL(raw, document.baseURI);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    event.preventDefault();
    parent.postMessage({ type: "${HTML_PREVIEW_OPEN_LINK_MESSAGE}", url: url.href }, "*");
  } catch (e) {}
});
`;

const ESCAPE_FORWARD_SCRIPT = `
addEventListener("keydown", function (event) {
  if (!event.isTrusted || event.defaultPrevented || event.key !== "Escape") return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  var target = event.target;
  var tag = target && target.tagName ? target.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) return;
  parent.postMessage({ type: "${HTML_PREVIEW_ESCAPE_MESSAGE}" }, "*");
});
`;

const buildPageScript = ({
  containScroll,
  forwardEscape,
  maxContentHeight,
  allowVerticalScrollAtMaxHeight,
}: {
  containScroll: boolean;
  forwardEscape: boolean;
  maxContentHeight: number;
  allowVerticalScrollAtMaxHeight: boolean;
}): string => `<script>(function () {
${containScroll ? 'document.documentElement.style.overflowY = "clip";' : ""}
${containScroll ? CONTAINED_SCROLL_INTO_VIEW : ""}
${LINK_INTERCEPT_SCRIPT}
${forwardEscape ? ESCAPE_FORWARD_SCRIPT : ""}
var last = -1;
function measure() {
  var root = document.documentElement;
  var body = document.body;
  if (!root || !body) return 0;
  var rect = body.getBoundingClientRect();
  var margin = parseFloat(getComputedStyle(body).marginBottom) || 0;
  var height = Math.max(rect.height, rect.bottom + margin);
  if (root.scrollHeight > root.clientHeight) height = Math.max(height, root.scrollHeight);
  return Math.ceil(height);
}
function report() {
  var height = measure();
  if (height <= 0 || height === last) return;
  last = height;
  ${containScroll && allowVerticalScrollAtMaxHeight ? `document.documentElement.style.overflowY = height > ${maxContentHeight} ? "auto" : "clip";` : ""}
  parent.postMessage({ type: "${HTML_PREVIEW_RESIZE_MESSAGE}", height: height }, "*");
}
if (window.ResizeObserver) {
  var observer = new ResizeObserver(report);
  observer.observe(document.documentElement);
  addEventListener("DOMContentLoaded", function () {
    if (document.body) observer.observe(document.body);
    report();
  });
} else {
  addEventListener("DOMContentLoaded", report);
}
addEventListener("load", report);
addEventListener("message", function (event) {
  var data = event.data;
  if (event.source !== parent || !data || data.type !== "${HTML_PREVIEW_THEME_MESSAGE}" || typeof data.css !== "string") return;
  var style = document.querySelector("style[data-odt-html-preview]");
  if (style) style.textContent = data.css;
});
})();</script>`;
