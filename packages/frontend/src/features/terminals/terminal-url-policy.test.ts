import { describe, expect, test } from "bun:test";
import { checkHttpUrl, findHttpUrls } from "./terminal-url-policy";

describe("terminal URL policy", () => {
  test("recognizes complete HTTP and HTTPS destinations", () => {
    const text =
      "open https://example.com:8443/a_(b)?query=one%20two#result and HTTP://[::1]:3000/logs";

    expect(findHttpUrls(text)).toEqual([
      {
        start: 5,
        end: 58,
        url: "https://example.com:8443/a_(b)?query=one%20two#result",
      },
      {
        start: 63,
        end: 85,
        url: "HTTP://[::1]:3000/logs",
      },
    ]);
  });

  test("removes sentence punctuation and unmatched closing brackets", () => {
    expect(findHttpUrls("See (https://example.com/docs_(v2)). Then continue.")).toEqual([
      {
        start: 5,
        end: 34,
        url: "https://example.com/docs_(v2)",
      },
    ]);
    expect(findHttpUrls("See https://example.com!")[0]?.url).toBe("https://example.com");
  });

  test("does not infer or repair unsupported destinations", () => {
    expect(findHttpUrls("localhost:3000 www.example.com file:///tmp/a mailto:a@b.test")).toEqual(
      [],
    );
    expect(checkHttpUrl(" https://example.com")).toBeNull();
    expect(checkHttpUrl("https://example.com/%zz")).toBeNull();
    expect(checkHttpUrl("https://exa\nmple.com")).toBeNull();
    expect(checkHttpUrl("javascript:alert(1)")).toBeNull();
  });

  test("preserves explicit OSC 8 destinations without trimming valid punctuation", () => {
    expect(checkHttpUrl("https://example.com/run!?q=ready!")).toBe(
      "https://example.com/run!?q=ready!",
    );
  });

  test("preserves valid punctuation at the end of plain-text links", () => {
    const urls = [
      "https://example.com/run!",
      "https://example.com/run;",
      "https://example.com/run:",
      "https://example.com/run?q=ready?",
    ];

    for (const url of urls) {
      expect(findHttpUrls(`Open ${url}`)[0]?.url).toBe(url);
    }
  });
});
