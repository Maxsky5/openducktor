import {
  buildHtmlPreviewHostControllerScript,
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  HTML_PREVIEW_SANDBOX,
} from "@openducktor/contracts/html-preview-policy";
import { ISOLATED_PREVIEW_PERMISSIONS_POLICY } from "@openducktor/contracts/preview-permissions-policy";

/** The fixed bootstrap document of a published HTML preview. */
export const HTML_PREVIEW_BOOTSTRAP_PATH = "/html-preview-bootstrap";

export const htmlPreviewBootstrapResponse = (): Response => new Response(html, { headers });

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `${HTML_PREVIEW_CONTENT_SECURITY_POLICY}; sandbox ${HTML_PREVIEW_SANDBOX}`,
  "Permissions-Policy": ISOLATED_PREVIEW_PERMISSIONS_POLICY,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=300",
};

const controllerScript = buildHtmlPreviewHostControllerScript({
  maxContentHeight: HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  forwardEscape: true,
});

// This document contains no session data. Only its exact parent can transfer a private channel.
// A srcdoc document inherits this local base so fragment links stay inside it.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>HTML preview</title>
<base href="about:srcdoc">
<script>
// The app surface travels in the fragment, so the wrapper paints the transcript color in its
// first frame instead of a white page while the published document mounts.
window.__odtApplyHtmlPreviewSurface = (surface) => {
  if (!surface || typeof surface !== "object") return;
  if (surface.appearance === "light" || surface.appearance === "dark") {
    document.documentElement.style.colorScheme = surface.appearance;
  }
  const background = surface.background;
  if (typeof background === "string" && background.length <= 100 &&
      CSS.supports("background-color", background)) {
    document.documentElement.style.background = background;
    window.__odtHtmlPreviewBackground = background;
  }
};
(() => {
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get("odt-surface");
    if (!raw) return;
    window.__odtApplyHtmlPreviewSurface(JSON.parse(raw));
  } catch {}
})();
</script>
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}iframe{display:block}</style>
</head><body><script>
(() => {
  ${controllerScript}
  const start = (event) => {
    if (event.source !== parent || !event.data || event.data.type !== "odt-html-preview-init" ||
        typeof event.data.generation !== "string" || event.data.generation.length > 128 ||
        event.ports.length !== 1) return;
    removeEventListener("message", start);
    const port = event.ports[0];
    const generation = event.data.generation;
    const controller = createHtmlPreviewController({
      onEvent: (payload) => port.postMessage({ ...payload, generation }),
      onFail: () => port.postMessage({ type: "failed", generation }),
      getFrameBackground: () => window.__odtHtmlPreviewBackground,
    });
    const render = (nextHtml) => {
      if (!controller.render(nextHtml)) return;
      // The trusted wrapper mounted the page. An external asset can stay pending or fail inside
      // it, and must not hold back the app's preview start state.
      port.postMessage({ type: "displayed", generation });
    };
    const stop = () => { controller.stop(); port.close(); };
    addEventListener("pagehide", stop, { once: true });
    port.onmessage = ({ data }) => {
      if (!data || data.generation !== generation) return;
      if (data.type === "dispose") { stop(); return; }
      if (data.type === "theme") {
        if (typeof data.css !== "string") return;
        if (data.surface) window.__odtApplyHtmlPreviewSurface(data.surface);
        controller.setTheme(data.css);
        return;
      }
      if (data.type !== "render") return;
      render(data.html);
    };
    if (typeof event.data.html === "string") {
      render(event.data.html);
    } else {
      port.postMessage({ type: "ready", generation });
    }
  };
  addEventListener("message", start);
})();
</script></body></html>`;
