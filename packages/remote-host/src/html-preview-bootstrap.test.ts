import { describe, expect, test } from "bun:test";
import {
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_RESTORE_LIMITS,
  HTML_PREVIEW_SANDBOX,
} from "@openducktor/contracts";
import {
  HTML_PREVIEW_BOOTSTRAP_PATH,
  htmlPreviewBootstrapResponse,
} from "./html-preview-bootstrap";

describe("HTML preview bootstrap", () => {
  test("keeps a fixed path and serves the shared page policy", async () => {
    expect(HTML_PREVIEW_BOOTSTRAP_PATH).toBe("/html-preview-bootstrap");
    const response = htmlPreviewBootstrapResponse();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(
      `${HTML_PREVIEW_CONTENT_SECURITY_POLICY}; sandbox ${HTML_PREVIEW_SANDBOX}`,
    );
    expect(response.headers.get("connection-allowlist")).toBeNull();
    expect(response.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  test("renders one sandboxed page and restores it after navigation", async () => {
    const html = await htmlPreviewBootstrapResponse().text();
    const { perWindow, windowMs, perGeneration } = HTML_PREVIEW_RESTORE_LIMITS;
    expect(html).toContain(`frame.sandbox = "${HTML_PREVIEW_SANDBOX}"`);
    expect(html).toContain("frame.srcdoc = html");
    expect(html).toContain('"odt-html-preview-init"');
    expect(html).toContain('typeof event.data.html === "string"');
    expect(html).toContain("previous.replaceWith(next)");
    expect(html).toContain('event.effectiveDirective === "frame-src"');
    expect(html).toContain('const wrapperUrl = document.URL.split("#", 1)[0]');
    expect(html).toContain("isWrapperDocument(event.documentURI)");
    expect(html).toContain('protocol !== "http:" && protocol !== "https:"');
    expect(html).toContain(`now - restoreWindow >= ${windowMs}`);
    expect(html).toContain(`windowRestores > ${perWindow} || restores > ${perGeneration}`);
    expect(html).toContain('type: "failed"');
    expect(html).toContain('type: "open-link"');
    expect(html).toContain('type: "escape"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("<script src=");
  });

  test("paints the app surface before the page mounts and updates it on live theme changes", async () => {
    const html = await htmlPreviewBootstrapResponse().text();

    expect(html).toContain('get("odt-surface")');
    expect(html).toContain('CSS.supports("background-color", background)');
    expect(html).toContain("document.documentElement.style.background = background");
    expect(html).toContain("frame.style.background = background");
    expect(html).toContain("current.style.background = background");
    expect(html).toContain("if (data.surface) window.__odtApplyHtmlPreviewSurface(data.surface)");
    expect(html.indexOf("odt-surface")).toBeLessThan(html.indexOf("<style>"));
  });
});
