import {
  buildHtmlPreviewHostControllerScript,
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
} from "@openducktor/contracts";
import { buildHtmlPreviewDocument } from "@openducktor/frontend-core/sessions/html-preview-document";
import { z } from "zod";
import { FRAME_BASE_URL } from "./web-view-bases";

/** The page inside the wrapper scrolls vertically only in the full-screen view. */
export type HtmlPreviewScroll = "inline" | "full";

const webViewMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    token: z.string().min(1),
    type: z.literal("resize"),
    height: z.number().finite().positive(),
  }),
  z.strictObject({
    token: z.string().min(1),
    type: z.literal("open-link"),
    url: z.string().min(1).max(4096),
  }),
  z.strictObject({
    token: z.string().min(1),
    type: z.literal("failed"),
  }),
]);

export type HtmlPreviewWebViewMessage =
  | { type: "resize"; height: number }
  | { type: "open-link"; url: string }
  | { type: "failed" };

/**
 * Parses and authenticates a message from the WebView bridge. Only messages carrying the exact
 * per-mount capability token bound inside the trusted main-frame wrapper closure are accepted;
 * messages posted directly from the sandboxed opaque-origin inner frame cannot read that token
 * and are dropped.
 */
export const parseHtmlPreviewWebViewMessage = (
  rawData: string,
  expectedToken: string,
): HtmlPreviewWebViewMessage | null => {
  if (expectedToken.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(rawData);
  } catch {
    return null;
  }
  const parsed = webViewMessageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.token !== expectedToken) return null;
  if (parsed.data.type === "resize") {
    return { type: "resize", height: parsed.data.height };
  }
  if (parsed.data.type === "open-link") {
    return { type: "open-link", url: parsed.data.url };
  }
  return { type: "failed" };
};

const scriptJson = (value: string): string =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

const cssColor = (value: string): string => value.replaceAll(/[^#(),.%/\sa-zA-Z0-9-]/g, "").trim();

/**
 * The trusted wrapper document of a published HTML page. It carries the shared content policy in
 * a meta tag, because a meta tag cannot carry the sandbox directive. The page runs in a sandboxed
 * `srcdoc` frame of this document, so it has an opaque origin.
 *
 * The wrapper binds `messageToken` inside its private closure and attaches it to every message
 * sent through `window.ReactNativeWebView.postMessage`. The sandboxed inner frame cannot read this
 * closure, so React Native rejects any unauthenticated bridge call without needing a native patch.
 */
export const buildHtmlPreviewWrapper = ({
  html,
  scroll,
  themeCss,
  background,
  foreground,
  messageToken,
}: {
  html: string;
  scroll: HtmlPreviewScroll;
  themeCss: string;
  background: string;
  foreground: string;
  messageToken: string;
}): string => {
  const isInline = scroll === "inline";
  const controllerScript = buildHtmlPreviewHostControllerScript({
    maxContentHeight: HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
    requireUserActivationForLinks: true,
    disableFrameScrolling: isInline,
  });
  const pageHtml = buildHtmlPreviewDocument(html, themeCss, {
    containScroll: isInline,
    maxContentHeight: HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
    allowVerticalScrollAtMaxHeight: false,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${FRAME_BASE_URL}">
<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CONTENT_SECURITY_POLICY}">
<meta name="referrer" content="no-referrer">
<title>HTML preview</title>
<style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${cssColor(background)}}
iframe{display:block;width:100%;height:100%;border:0}
#error{padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${cssColor(foreground)};background:${cssColor(background)}}
#error[hidden]{display:none}
</style>
</head><body>
<div id="error" role="alert" hidden>The preview cannot stay open because it navigates away when it loads. Open the page full screen to read the published HTML.</div>
<script>
(() => {
  ${controllerScript}
  const html = ${scriptJson(pageHtml)};
  const token = ${scriptJson(messageToken)};
  const postToApp = (payload) => {
    try {
      const bridge = window.ReactNativeWebView;
      if (bridge && typeof bridge.postMessage === "function") {
        bridge.postMessage(JSON.stringify({ token, ...payload }));
      }
    } catch {}
  };
  const controller = createHtmlPreviewController({
    onEvent: postToApp,
    onFail: () => {
      document.getElementById("error").hidden = false;
      postToApp({ type: "failed" });
    },
  });
  window.__odtApplyTheme = (nextCss, nextBackground, nextForeground) => {
    if (typeof nextBackground === "string" && nextBackground.length <= 100 && CSS.supports("background-color", nextBackground)) {
      document.documentElement.style.background = nextBackground;
      if (document.body) document.body.style.background = nextBackground;
      const err = document.getElementById("error");
      if (err) err.style.background = nextBackground;
    }
    if (typeof nextForeground === "string" && nextForeground.length <= 100 && CSS.supports("color", nextForeground)) {
      const err = document.getElementById("error");
      if (err) err.style.color = nextForeground;
    }
    controller.setTheme(nextCss);
  };
  controller.setTheme(${scriptJson(themeCss)});
  controller.render(html);
})();
</script></body></html>`;
};
