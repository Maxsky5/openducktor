import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publishedPages } from "../lib/pages";
import { findBrokenLinks, legalNotice } from "../scripts/finish-export";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Writes a content folder with the given files, and returns its path. */
function contentFolder(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "docs-content-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

const meta = (pages: string[]) => JSON.stringify({ pages });

test("publishedPages lists the pages in navigation order, with nested folders", () => {
  const content = contentFolder({
    "meta.json": meta(["---Start here---", "index", "coding-sessions", "mobile"]),
    "index.mdx": "",
    "mobile.mdx": "",
    "coding-sessions/meta.json": meta(["terminals", "deep"]),
    "coding-sessions/index.mdx": "",
    "coding-sessions/terminals.mdx": "",
    "coding-sessions/deep/meta.json": meta(["details"]),
    "coding-sessions/deep/index.mdx": "",
    "coding-sessions/deep/details.mdx": "",
  });
  expect(publishedPages(content)).toEqual([
    { url: "/", file: "content/index.mdx" },
    { url: "/coding-sessions/", file: "content/coding-sessions/index.mdx" },
    { url: "/coding-sessions/terminals/", file: "content/coding-sessions/terminals.mdx" },
    { url: "/coding-sessions/deep/", file: "content/coding-sessions/deep/index.mdx" },
    { url: "/coding-sessions/deep/details/", file: "content/coding-sessions/deep/details.mdx" },
    { url: "/mobile/", file: "content/mobile.mdx" },
  ]);
});

test("publishedPages stops on a navigation entry without a file", () => {
  const content = contentFolder({
    "meta.json": meta(["index", "coding-sessions"]),
    "index.mdx": "",
    "coding-sessions/meta.json": meta(["terminal"]),
    "coding-sessions/index.mdx": "",
  });
  expect(() => publishedPages(content)).toThrow(
    'content/coding-sessions/meta.json lists "terminal", but content/coding-sessions/terminal.mdx and its folder do not exist.',
  );
});

const page = (body: string) => `<html><body><h1 id="docs-title">Title</h1>${body}</body></html>`;

test("findBrokenLinks accepts links to published pages, their sections, and static files", () => {
  const pages = new Map([
    ["/", page('<a href="/mobile/#connect">Connect</a><a href="/favicon.svg">Icon</a>')],
    [
      "/mobile/",
      page(
        '<h2 id="connect">Connect</h2><a href="#connect">Here</a><a href="https://example.com/">Out</a>',
      ),
    ],
  ]);
  expect(findBrokenLinks(pages, new Set(["/favicon.svg"]))).toEqual([]);
});

test("findBrokenLinks reports a missing page and a missing section", () => {
  const pages = new Map([
    ["/", page('<a href="/gone/">Gone</a><a class="x" href="/mobile/#nowhere">Section</a>')],
    ["/mobile/", page("")],
  ]);
  expect(findBrokenLinks(pages, new Set())).toEqual([
    "/ links to /gone/, which is not a published page.",
    '/ links to /mobile/#nowhere, but /mobile/ has no section "nowhere".',
  ]);
});

test("legalNotice finds the license comment of a package file", () => {
  expect(
    legalNotice("function a() {}\n/*!\n * GSAP 3\n * @license Copyright\n*/\nfunction run() {}"),
  ).toBe("/*!\n * GSAP 3\n * @license Copyright\n*/");
  expect(() => legalNotice("function run() {}")).toThrow("A GSAP file has no license notice.");
});
