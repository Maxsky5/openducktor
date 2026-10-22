import { describe, expect, test } from "bun:test";
import { createFetchFixture } from "../test-support";
import { checkSiteFraming, siteFramingFromHeaders } from "./browser-frame-check";

const APP = "http://localhost:5555";
const SITE = new URL("https://example.com/docs");

const framing = (headers: Record<string, string>) =>
  siteFramingFromHeaders(new Headers(headers), SITE, APP).kind;

describe("site framing", () => {
  test("lets a site without frame rules show in the app", () => {
    expect(framing({})).toBe("direct");
    expect(framing({ "content-security-policy": "default-src 'self'" })).toBe("direct");
  });

  test("refuses a site that sends X-Frame-Options DENY or SAMEORIGIN", () => {
    expect(framing({ "x-frame-options": "DENY" })).toBe("refused");
    expect(framing({ "x-frame-options": "sameorigin" })).toBe("refused");
  });

  test("follows frame-ancestors before X-Frame-Options", () => {
    expect(
      framing({ "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" }),
    ).toBe("direct");
    expect(framing({ "content-security-policy": "frame-ancestors 'self'" })).toBe("refused");
    expect(framing({ "content-security-policy": "frame-ancestors 'none'" })).toBe("refused");
  });

  test("matches frame-ancestors sources against the app origin", () => {
    expect(framing({ "content-security-policy": "frame-ancestors http://localhost:5555" })).toBe(
      "direct",
    );
    expect(framing({ "content-security-policy": "frame-ancestors http://localhost:*" })).toBe(
      "direct",
    );
    expect(framing({ "content-security-policy": "frame-ancestors http:" })).toBe("direct");
    expect(framing({ "content-security-policy": "frame-ancestors localhost:5555" })).toBe(
      "refused",
    );
    expect(framing({ "content-security-policy": "frame-ancestors https://*.example.com" })).toBe(
      "refused",
    );
  });

  test("needs every policy to allow the app", () => {
    expect(
      framing({ "content-security-policy": "frame-ancestors *, frame-ancestors 'self'" }),
    ).toBe("refused");
  });
});

describe("checkSiteFraming", () => {
  test("reads the frame rules of the page after its redirects", async () => {
    const requested: string[] = [];
    const fetch = createFetchFixture(async (input) => {
      requested.push(String(input));
      const response = new Response("<html></html>", { headers: { "x-frame-options": "DENY" } });
      Object.defineProperty(response, "url", { value: "https://www.github.com/" });
      return response;
    });

    const result = await checkSiteFraming({ target: "https://github.com/", appOrigin: APP, fetch });

    expect(requested).toEqual(["https://github.com/"]);
    expect(result).toEqual({
      kind: "refused",
      message: "www.github.com does not let other sites show its pages in a frame.",
    });
  });

  test("names the site and the reason when the site does not answer", async () => {
    const fetch = createFetchFixture(async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND nope.test") });
    });

    await expect(
      checkSiteFraming({ target: "https://nope.test/", appOrigin: APP, fetch }),
    ).rejects.toThrow("Could not reach nope.test: getaddrinfo ENOTFOUND nope.test");
  });
});
