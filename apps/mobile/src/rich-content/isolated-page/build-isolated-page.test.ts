import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildIsolatedPage,
  buildIsolatedPages,
  PAGE_SOURCE_DIRECTORY,
} from "../../../scripts/build-isolated-page";
import { pageCspMeta } from "../../test-support/page-csp";

/** The page markup without the text of its inline script and style elements. */
const markupOnly = (html: string): string =>
  html
    .replace(/<script>[\s\S]*?<\/script>/g, "<script></script>")
    .replace(/<style>[\s\S]*?<\/style>/g, "<style></style>");

const styleText = (html: string): string => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";

const expectSelfContained = (html: string): void => {
  // Only the page script runs: the CSP allows its hash and no other inline script.
  expect(html).toContain(pageCspMeta(html));
  const markup = markupOnly(html);
  expect(markup).not.toMatch(/\s(?:src|href|action)\s*=/i);
  expect(markup.match(/<script/g)).toHaveLength(1);
  const style = styleText(html);
  expect(style).not.toMatch(/url\(\s*["']?(?!data:)/);
  expect(style).not.toContain("@import");
};

// Static built-ins that came after Safari 16.4, the WebKit of the oldest supported iOS version.
const NEWER_BUILT_INS = [
  "Promise.withResolvers",
  "Promise.try",
  "Object.groupBy",
  "Map.groupBy",
  "Array.fromAsync",
  "Iterator.from",
  "RegExp.escape",
  "Math.sumPrecise",
  "Error.isError",
  "Uint8Array.fromBase64",
  "Uint8Array.fromHex",
];
// `page-src/shared/page-globals.ts` supplies these when the WebView lacks them.
const SUPPLIED_BUILT_INS = new Set(["Promise.withResolvers", "Object.groupBy"]);

const unsuppliedBuiltIns = (html: string): string[] =>
  NEWER_BUILT_INS.filter((name) => !SUPPLIED_BUILT_INS.has(name) && html.includes(name));

const fixtureDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-pages-"));
  await mkdir(path.join(directory, "src", "shared"), { recursive: true });
  await mkdir(path.join(directory, "src", "fonts"), { recursive: true });
  await writeFile(path.join(directory, "src", "fonts", "Demo.woff2"), new Uint8Array([1, 2, 3]));
  await writeFile(path.join(directory, "src", "fonts", "Demo.woff"), new Uint8Array([4, 5, 6]));
  await writeFile(
    path.join(directory, "src", "shared", "text.ts"),
    'export const closing = "</script><!-- x";\n',
  );
  await writeFile(
    path.join(directory, "src", "demo.ts"),
    'import { closing } from "./shared/text";\nconsole.log(closing);\n',
  );
  await writeFile(
    path.join(directory, "src", "demo.css"),
    '@font-face{font-family:Demo;src:url(fonts/Demo.woff2) format("woff2"),url(fonts/Demo.woff) format("woff")}\nbody{font-family:Demo}\n',
  );
  return directory;
};

describe("buildIsolatedPages", () => {
  test("builds each entry into one self-contained page with its CSP", async () => {
    const directory = await fixtureDirectory();
    const output = path.join(directory, "pages");
    const pages = await buildIsolatedPages(path.join(directory, "src"), output);
    expect(pages.map((page) => page.name)).toEqual(["demo"]);
    const html = await readFile(path.join(output, "demo.html"), "utf8");
    expectSelfContained(html);
    expect(styleText(html)).toContain(
      `src:url(data:font/woff2;base64,${Buffer.from([1, 2, 3]).toString("base64")})`,
    );
    expect(styleText(html)).not.toContain("font/woff;");
    // Text in the script cannot close the script element or open an HTML comment.
    expect(html).toContain("\\x3C/script>\\x3C!-- x");
  });

  test("fails when the page CSS would load a file or a remote resource", async () => {
    const directory = await fixtureDirectory();
    await writeFile(
      path.join(directory, "src", "demo.css"),
      "body{background:url(https://example.com/a.png)}\n",
    );
    const failure = await buildIsolatedPage(path.join(directory, "src", "demo.ts")).catch(
      (cause: Error) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Pages load no file or remote resource");
  });

  // This test runs the real bundler on Mermaid, KaTeX, xterm.js, and their fonts.
  test("builds the pages without external loads or built-ins that old WebViews lack", async () => {
    for (const name of ["rich-block", "rich-diagram", "terminal"]) {
      const html = await buildIsolatedPage(path.join(PAGE_SOURCE_DIRECTORY, `${name}.ts`));
      expectSelfContained(html);
      expect(unsuppliedBuiltIns(html)).toEqual([]);
      // The terminal page inlines IBM Plex Mono as TrueType. The other pages inline woff2 fonts.
      const font = name === "terminal" ? "ttf" : "woff2";
      expect(styleText(html)).toContain(`src:url(data:font/${font};base64,`);
      expect(html).toContain('<div id="root"></div>');
    }
  }, 10_000);
});
