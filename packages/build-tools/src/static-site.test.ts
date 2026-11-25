import { describe, expect, test } from "bun:test";
import { headersFile, readBuildTarget, robotsFile } from "./static-site";

describe("readBuildTarget", () => {
  test("builds for local use by default", () => {
    expect(readBuildTarget("SITE_BUILD_TARGET", undefined)).toBe("local");
  });

  test("refuses an unknown target with the variable and the accepted values", () => {
    expect(() => readBuildTarget("SITE_BUILD_TARGET", "staging")).toThrow(
      "Set SITE_BUILD_TARGET to local, preview, or production.",
    );
  });
});

describe("headersFile", () => {
  test.each(["local", "preview", "production"] as const)(
    "the %s pages load only their own files, cannot show in a frame, and use only HTTPS",
    (target) => {
      const headers = headersFile(target, ["/assets/*"]);
      const [pageHeaders = ""] = headers.split("\n/assets/*\n", 1);
      expect(pageHeaders).toMatch(/^\/\*\n  X-Content-Type-Options: nosniff\n/);
      const policy = pageHeaders.match(/^  Content-Security-Policy: (.+)$/m)?.[1];
      expect(policy?.split("; ")).toEqual([
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ]);
      expect(pageHeaders).toMatch(
        /^  Strict-Transport-Security: max-age=31536000; includeSubDomains$/m,
      );
    },
  );

  test("only production pages can be indexed", () => {
    expect(headersFile("production", [])).not.toContain("X-Robots-Tag");
    expect(headersFile("local", [])).toContain("  X-Robots-Tag: noindex, nofollow\n");
    expect(headersFile("preview", [])).toContain("  X-Robots-Tag: noindex, nofollow\n");
  });

  test("caches only the hashed files for a year, with one rule for each pattern", () => {
    const headers = headersFile("production", ["/scripts/*", "/styles/*"]);
    const cache = "Cache-Control: public, max-age=31556952, immutable";
    expect(headers).toContain(`/scripts/*\n  ${cache}\n`);
    expect(headers).toContain(`/styles/*\n  ${cache}\n`);
    expect(headers.match(/Cache-Control:/g)).toHaveLength(2);
  });
});

test("robots.txt names the sitemap of an indexable site, and blocks every other site", () => {
  expect(robotsFile("https://doc.openducktor.dev/sitemap.xml")).toBe(
    "User-agent: *\nAllow: /\nSitemap: https://doc.openducktor.dev/sitemap.xml\n",
  );
  expect(robotsFile(null)).toBe("User-agent: *\nDisallow: /\n");
});
