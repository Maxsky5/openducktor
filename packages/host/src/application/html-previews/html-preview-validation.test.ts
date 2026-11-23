import { describe, expect, test } from "bun:test";
import { findHtmlPreviewViewportHeight } from "./html-preview-validation";

describe("findHtmlPreviewViewportHeight", () => {
  test("detects viewport height CSS units in style elements and style attributes", () => {
    expect(findHtmlPreviewViewportHeight("<style>body { min-height: 100vh; }</style>")).toBe(
      "100vh",
    );
    expect(findHtmlPreviewViewportHeight("<style>.hero { height: 50dvh; }</style>")).toBe("50dvh");
    expect(findHtmlPreviewViewportHeight('<div style="max-height: .5svh">x</div>')).toBe(".5svh");
    expect(findHtmlPreviewViewportHeight("<div style=height:80lvh>x</div>")).toBe("80lvh");
  });

  test("detects Tailwind viewport-height utility classes", () => {
    expect(findHtmlPreviewViewportHeight('<div class="flex min-h-screen flex-col">x</div>')).toBe(
      "min-h-screen",
    );
    expect(findHtmlPreviewViewportHeight('<main class="md:h-dvh">x</main>')).toBe("md:h-dvh");
    expect(findHtmlPreviewViewportHeight('<section class="lg:!h-[85vh]">x</section>')).toBe(
      "lg:!h-[85vh]",
    );
    expect(findHtmlPreviewViewportHeight('<div class="max-h-svh">x</div>')).toBe("max-h-svh");
  });

  test("ignores comments, scripts, templates, prose text, and base64 payloads", () => {
    expect(
      findHtmlPreviewViewportHeight(`
        <!doctype html>
        <!-- <div style="height: 100vh" class="min-h-screen"></div> -->
        <style>/* height: 100vh */ .card { min-height: 240px; }</style>
        <p>Do not write style="height: 100vh" or class="min-h-screen" in reports.</p>
        <script>const example = '<div style="height:100vh" class="min-h-screen"></div>';</script>
        <template><div style="height: 100vh" class="h-screen"></div></template>
        <img src="data:image/png;base64,AAAA1vhBBBB" alt="chart" />
      `),
    ).toBeUndefined();
  });

  test("allows ordinary Tailwind height and non-viewport units", () => {
    expect(
      findHtmlPreviewViewportHeight(
        '<div class="h-full min-h-0 h-64 max-w-screen-lg" style="height: 400px; width: 100vw">ok</div>',
      ),
    ).toBeUndefined();
  });

  test("ignores viewport-height examples inside other quoted attributes and catches adjacent HTML5 attributes", () => {
    expect(
      findHtmlPreviewViewportHeight(
        `<div title='Avoid class="h-screen"' data-doc='style="height: 100vh"'>ok</div>`,
      ),
    ).toBeUndefined();
    expect(findHtmlPreviewViewportHeight('<div id="a"style="height:100vh">bad</div>')).toBe(
      "100vh",
    );
    expect(findHtmlPreviewViewportHeight('<div id="a"class="min-h-screen">bad</div>')).toBe(
      "min-h-screen",
    );
  });
});
