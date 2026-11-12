import { describe, expect, test } from "bun:test";
import { ASSET_CACHE, CONTENT_SECURITY_POLICY } from "@openducktor/build-tools/static-site";
import { headersFile, readBuildTarget, robotsFile, SITE_ORIGIN } from "../config/site";

test("reads DOCS_BUILD_TARGET and names it in the error", () => {
  expect(readBuildTarget(undefined)).toBe("local");
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

test("only the content-hashed Next.js assets and scene stylesheets are cached for a year", () => {
  const headers = headersFile("production");
  expect(headers).toContain(`/_next/static/*\n  Cache-Control: ${ASSET_CACHE}\n`);
  expect(headers).toContain(`/scene-styles/*\n  Cache-Control: ${ASSET_CACHE}\n`);
  expect(headers.match(/Cache-Control/g)).toHaveLength(2);
  expect(headers).toContain(`  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}\n`);
});
