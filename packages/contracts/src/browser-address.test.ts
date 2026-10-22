import { describe, expect, test } from "bun:test";
import { browserUrlScheme, limitBrowserUrl, parseBrowserAddress } from "./browser-address";
import { isBrowserNavigableUrl, isBrowserTabLoadableUrl } from "./browser-url-rules";

describe("parseBrowserAddress", () => {
  test.each([
    ["localhost:3000", "http://localhost:3000/"],
    ["app.localhost/path?x=1", "http://app.localhost/path?x=1"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080/"],
    ["192.168.1.20", "http://192.168.1.20/"],
    ["10.0.0.4:5173/a", "http://10.0.0.4:5173/a"],
    ["172.20.0.1", "http://172.20.0.1/"],
    ["172.32.0.1", "https://172.32.0.1/"],
    ["[::1]:4000", "http://[::1]:4000/"],
    ["[fd00::1]:3000", "http://[fd00::1]:3000/"],
    ["example.com", "https://example.com/"],
    ["docs.example.com/guide#top", "https://docs.example.com/guide#top"],
    ["8.8.8.8", "https://8.8.8.8/"],
    ["  http://example.com  ", "http://example.com/"],
    ["HTTPS://Example.com/A", "https://example.com/A"],
  ])("turns %s into %s", (input, url) => {
    expect(parseBrowserAddress(input)).toEqual({ ok: true, url });
  });

  test.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
    "chrome://settings",
    "ftp://example.com",
    "about:blank",
  ])("refuses the scheme of %s", (input) => {
    const result = parseBrowserAddress(input);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "scheme" });
  });

  test.each(["what is react", "react", "", "   ", "http://"])(
    "refuses text that is not an address: %j",
    (input) => {
      expect(parseBrowserAddress(input).ok).toBe(false);
    },
  );
});

describe("browser URL helpers", () => {
  test("only http and https pages are navigable", () => {
    expect(isBrowserNavigableUrl("https://example.com")).toBe(true);
    expect(isBrowserNavigableUrl("http://localhost:3000")).toBe(true);
    expect(isBrowserNavigableUrl("file:///tmp/a")).toBe(false);
    expect(isBrowserNavigableUrl("not a url")).toBe(false);
    expect(isBrowserTabLoadableUrl("about:blank#top")).toBe(true);
    expect(isBrowserTabLoadableUrl("javascript:alert(1)")).toBe(false);
    expect(isBrowserTabLoadableUrl("data:text/html,hi")).toBe(false);
  });

  test("names the scheme of a URL", () => {
    expect(browserUrlScheme("Mailto:a@b.c")).toBe("mailto");
    expect(browserUrlScheme("localhost")).toBeNull();
  });
});

describe("limitBrowserUrl", () => {
  test("keeps a short URL and shortens a long one step by step", () => {
    const long = "a".repeat(9_000);

    expect(limitBrowserUrl("http://localhost:3000/app?x=1#top")).toBe(
      "http://localhost:3000/app?x=1#top",
    );
    expect(limitBrowserUrl(`http://localhost:3000/app?x=1#${long}`)).toBe(
      "http://localhost:3000/app?x=1",
    );
    expect(limitBrowserUrl(`http://localhost:3000/app?${long}`)).toBe("http://localhost:3000/app");
    expect(limitBrowserUrl(`http://localhost:3000/${long}`)).toBe("http://localhost:3000/");
  });
});
