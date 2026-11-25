import { describe, expect, test } from "bun:test";
import { headersFile, readBuildTarget, robotsFile, SITE_ORIGIN } from "../config/site";

test("names DOCS_BUILD_TARGET in the error for an invalid value", () => {
  expect(() => readBuildTarget("staging")).toThrow(
    "Set DOCS_BUILD_TARGET to local, preview, or production.",
  );
});

describe("production output", () => {
  test("lets search engines index the pages and find the sitemap", () => {
    expect(robotsFile("production")).toBe(
      `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
    );
    expect(headersFile("production")).not.toContain("X-Robots-Tag");
  });
});

describe.each(["local", "preview"] as const)("%s output", (target) => {
  test("cannot be indexed", () => {
    expect(robotsFile(target)).toBe("User-agent: *\nDisallow: /\n");
    expect(headersFile(target)).toContain("X-Robots-Tag: noindex, nofollow");
  });
});

test("sets cache rules only for hashed Next.js assets and scene stylesheets", () => {
  const headers = headersFile("production");
  expect(headers).toMatch(/^\/_next\/static\/\*\n  Cache-Control: /m);
  expect(headers).toMatch(/^\/scene-styles\/\*\n  Cache-Control: /m);
  expect(headers.match(/Cache-Control:/g)).toHaveLength(2);
});
