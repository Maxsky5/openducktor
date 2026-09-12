import { describe, expect, test } from "bun:test";
import { findTerminalHttpUrls, validateTerminalHttpUrl } from "./terminal-url-policy";

describe("terminal URL policy", () => {
  test("recognizes complete HTTP and HTTPS destinations", () => {
    const text =
      "open https://example.com:8443/a_(b)?query=one%20two#result and HTTP://[::1]:3000/logs";

    expect(findTerminalHttpUrls(text)).toEqual([
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
    expect(findTerminalHttpUrls("See (https://example.com/docs_(v2)). Then continue.")).toEqual([
      {
        start: 5,
        end: 34,
        url: "https://example.com/docs_(v2)",
      },
    ]);
  });

  test("does not infer or repair unsupported destinations", () => {
    expect(
      findTerminalHttpUrls("localhost:3000 www.example.com file:///tmp/a mailto:a@b.test"),
    ).toEqual([]);
    expect(validateTerminalHttpUrl(" https://example.com")).toBeNull();
    expect(validateTerminalHttpUrl("https://example.com/%zz")).toBeNull();
    expect(validateTerminalHttpUrl("https://exa\nmple.com")).toBeNull();
    expect(validateTerminalHttpUrl("javascript:alert(1)")).toBeNull();
  });
});
