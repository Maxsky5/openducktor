import { describe, expect, test } from "bun:test";
import { ASSET_CACHE, headersFile, readBuildConfig, staticFiles } from "../config/build";

describe("build identity and indexing", () => {
  test("local builds do not invent a production origin", () => {
    const config = readBuildConfig({});
    expect(config).toEqual({ target: "local", origin: undefined });
    expect(staticFiles(config).has("sitemap.xml")).toBe(false);
    expect(staticFiles(config).get("robots.txt")).toContain("Disallow: /");
  });
  test("production requires an origin and emits only its homepage", () => {
    expect(() => readBuildConfig({ MARKETING_BUILD_TARGET: "production" })).toThrow(
      "MARKETING_SITE_ORIGIN",
    );
    const files = staticFiles(
      readBuildConfig({
        MARKETING_BUILD_TARGET: "production",
        MARKETING_SITE_ORIGIN: "https://marketing.openducktor.dev",
      }),
    );
    expect(files.get("sitemap.xml")).toContain("<loc>https://marketing.openducktor.dev/</loc>");
    expect(files.get("robots.txt")).toContain(
      "Sitemap: https://marketing.openducktor.dev/sitemap.xml",
    );
    expect(files.get("_headers")).not.toContain("noindex");
  });
  test("preview with an origin still disallows indexing", () => {
    const files = staticFiles(
      readBuildConfig({
        MARKETING_BUILD_TARGET: "preview",
        MARKETING_SITE_ORIGIN: "https://marketing.openducktor.dev",
      }),
    );
    expect(files.get("_headers")).toContain("X-Robots-Tag: noindex, nofollow");
    expect(files.has("sitemap.xml")).toBe(false);
  });
  test.each([
    "http://openducktor.dev",
    "https://example.com",
    "https://sub.example.org",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://preview.workers.dev",
    "https://preview.pages.dev",
    "https://openducktor.dev/path",
    "https://openducktor.dev?query=1",
    "https://openducktor.dev/#fragment",
    "https://user:pass@openducktor.dev",
    "not a URL",
    "https://openducktor.dev:4321",
  ])("rejects invalid production identity %s", (origin) => {
    expect(() => readBuildConfig({ MARKETING_SITE_ORIGIN: origin })).toThrow(
      "MARKETING_SITE_ORIGIN",
    );
  });
  test.each(["local", "preview", "production"] as const)(
    "a %s build keeps the hashed files of _astro/ for a year, and only them",
    (target) => {
      const headers = headersFile(target);
      expect(headers).toContain(`/_astro/*\n  Cache-Control: ${ASSET_CACHE}\n`);
      // Cloudflare joins the values of two matching rules, so only one rule sets the cache.
      expect(headers.match(/Cache-Control/g)).toHaveLength(1);
    },
  );
  test("rejects an unknown build target", () => {
    expect(() => readBuildConfig({ MARKETING_BUILD_TARGET: "staging" })).toThrow(
      "MARKETING_BUILD_TARGET",
    );
  });
});
