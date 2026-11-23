import { describe, expect, test } from "bun:test";
import {
  HTML_PREVIEW_ESCAPE_MESSAGE,
  HTML_PREVIEW_OPEN_LINK_MESSAGE,
  HTML_PREVIEW_RESIZE_MESSAGE,
  HTML_PREVIEW_THEME_MESSAGE,
} from "@openducktor/contracts";
import { buildHtmlPreviewDocument, buildHtmlPreviewThemeSheet } from "./html-preview-document";

const theme = ":root{--background:black}";
const additions = `<style data-odt-html-preview="">${theme}</style>`;

describe("buildHtmlPreviewDocument", () => {
  test("adds the theme and reporter after the head start", () => {
    const page = buildHtmlPreviewDocument(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report</title></head><body><h1>Hi</h1></body></html>',
      theme,
    );

    expect(page.startsWith('<!doctype html><html lang="en"><head>')).toBe(true);
    expect(page.indexOf(additions)).toBeLessThan(page.indexOf('<meta charset="utf-8">'));
    expect(page).toContain(HTML_PREVIEW_RESIZE_MESSAGE);
    expect(page).toContain(HTML_PREVIEW_THEME_MESSAGE);
    expect(page).toContain("<h1>Hi</h1>");
    expect(page.endsWith("</body></html>")).toBe(true);
  });

  test("adds charset and viewport defaults when the page omits them", () => {
    const page = buildHtmlPreviewDocument("<html><head><title>Plain</title></head></html>", theme);

    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  test("keeps authored charset and viewport metadata", () => {
    const page = buildHtmlPreviewDocument(
      '<html><head><meta charset="iso-8859-1"><meta name="viewport" content="width=800"><title>Own</title></head></html>',
      theme,
    );

    expect(page.match(/<meta charset=/g)).toHaveLength(1);
    expect(page.match(/<meta name="viewport"/g)).toHaveLength(1);
    expect(page).toContain('<meta charset="iso-8859-1">');
    expect(page).toContain('<meta name="viewport" content="width=800">');
  });

  test("contains scrollIntoView, resolves relative links against document.baseURI, and clips vertical overflow in inline pages", () => {
    const inline = buildHtmlPreviewDocument("<p>Inline</p>", theme, { containScroll: true });
    expect(inline).toContain("Element.prototype.scrollIntoView = function");
    expect(inline).toContain("scrollPadding");
    expect(inline).toContain('document.documentElement.style.overflowY = "clip"');
    expect(inline).toContain('style.overflowY = height > 20000 ? "auto" : "clip"');
    expect(inline).toContain("new URL(raw, document.baseURI)");
    expect(inline).toContain(HTML_PREVIEW_OPEN_LINK_MESSAGE);
    expect(inline).not.toContain(HTML_PREVIEW_ESCAPE_MESSAGE);

    const fullscreen = buildHtmlPreviewDocument("<p>Full</p>", theme, { forwardEscape: true });
    expect(fullscreen).not.toContain("Element.prototype.scrollIntoView");
    expect(fullscreen).not.toContain('style.overflowY = "clip"');
    expect(fullscreen).toContain(HTML_PREVIEW_OPEN_LINK_MESSAGE);
    expect(fullscreen).toContain(HTML_PREVIEW_ESCAPE_MESSAGE);

    const mobileInline = buildHtmlPreviewDocument("<p>Mobile inline</p>", theme, {
      containScroll: true,
      maxContentHeight: 2000,
      allowVerticalScrollAtMaxHeight: false,
    });
    expect(mobileInline).toContain('document.documentElement.style.overflowY = "clip"');
    expect(mobileInline).not.toContain('? "auto" : "clip"');
  });

  test("reports the first height without waiting for an animation frame", () => {
    const page = buildHtmlPreviewDocument("<p>Inline</p>", theme, { containScroll: true });

    // A preview above the fold has no rendering phase, and its animation frames stay suspended.
    expect(page).toContain('addEventListener("DOMContentLoaded"');
    expect(page).toContain("observer.observe(document.body)");
    expect(page).toContain("new ResizeObserver(report)");
    expect(page).not.toContain("requestAnimationFrame");
  });

  test("creates a head after the html start when the page has none", () => {
    const page = buildHtmlPreviewDocument("<html><body><p>Plain</p></body></html>", theme);

    expect(page.startsWith("<html><head>")).toBe(true);
    expect(page).toContain(additions);
    expect(page.endsWith("<body><p>Plain</p></body></html>")).toBe(true);
  });

  test("creates a head after the doctype when the page has no html element", () => {
    const page = buildHtmlPreviewDocument("<!doctype html><p>Plain</p>", theme);

    expect(page.startsWith("<!doctype html><head>")).toBe(true);
    expect(page.endsWith("<p>Plain</p>")).toBe(true);
  });

  test("keeps a page without a doctype in quirks mode", () => {
    const page = buildHtmlPreviewDocument("<p>Quirks</p>", theme);

    expect(page.startsWith("<head>")).toBe(true);
    expect(page).not.toContain("<!doctype");
    expect(page.endsWith("<p>Quirks</p>")).toBe(true);
  });

  test("ignores a head element inside a script, comment, or template", () => {
    const scriptPage = buildHtmlPreviewDocument(
      '<html><head><script>const sample = "<head>";</script><title>Real</title></head><body></body></html>',
      theme,
    );
    expect(scriptPage.indexOf(additions)).toBeLessThan(scriptPage.indexOf("<script>"));
    expect(scriptPage).toContain('<script>const sample = "<head>";</script>');

    const commentPage = buildHtmlPreviewDocument(
      "<html><head><!-- <head> --><title>Real</title></head><body></body></html>",
      theme,
    );
    expect(commentPage.indexOf(additions)).toBeLessThan(commentPage.indexOf("<!--"));

    const templatePage = buildHtmlPreviewDocument(
      "<html><head><template><head></head></template><title>Real</title></head><body></body></html>",
      theme,
    );
    expect(templatePage.indexOf(additions)).toBeLessThan(templatePage.indexOf("<template>"));
  });

  test("finds the doctype after a leading comment", () => {
    const page = buildHtmlPreviewDocument("<!-- note --><!doctype html><p>Plain</p>", theme);

    expect(page).toContain("<!doctype html><head>");
    expect(page).toContain("<!-- note --><!doctype html>");
  });

  test("keeps the original source out of the additions", () => {
    const html = "<!doctype html><html><head><title>Source</title></head><body></body></html>";
    const page = buildHtmlPreviewDocument(html, theme);

    expect(page.slice(page.indexOf("<title>"))).toBe(html.slice(html.indexOf("<title>")));
  });
});

describe("buildHtmlPreviewThemeSheet", () => {
  test("adds the app theme, font stacks, and page defaults", () => {
    const css = buildHtmlPreviewThemeSheet({
      appearance: "dark",
      variables: { "--background": "#000", "--chat-background": "#111" },
      fontSans: '"Space Grotesk", sans-serif',
      fontMono: '"IBM Plex Mono", monospace',
      radius: "0.75rem",
    });

    expect(css).toContain(
      ':root{color-scheme:dark;--font-sans:"Space Grotesk", sans-serif;--font-mono:"IBM Plex Mono", monospace;--background:#000;--chat-background:#111;--radius:0.75rem}',
    );
    expect(css).toContain("background:var(--chat-background,var(--background))");
    expect(css).toContain("code,kbd,pre,samp{font-family:var(--font-mono)}");
    expect(css).toContain(":where(:focus-visible){outline:2px solid var(--ring)}");
    // A contained page would keep the wheel from scrolling the transcript.
    expect(css).not.toContain("overscroll-behavior");
  });

  test("drops values that could leave the theme rule", () => {
    const css = buildHtmlPreviewThemeSheet({
      appearance: "light",
      variables: { "--background": "#fff;}", "--bad name": "#000" },
      fontSans: "sans",
      fontMono: "mono",
    });

    expect(css).toContain("--background:#fff");
    expect(css).not.toContain("--bad name");
    expect(css).not.toContain("#fff;}");
  });
});
