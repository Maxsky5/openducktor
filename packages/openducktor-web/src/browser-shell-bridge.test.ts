import { describe, expect, test } from "bun:test";
import { validateExternalBrowserUrl } from "./browser-shell-bridge";

describe("browser shell bridge", () => {
  test("allows absolute http and https external URLs", () => {
    expect(validateExternalBrowserUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(validateExternalBrowserUrl(" http://localhost:1420/kanban ")).toBe(
      "http://localhost:1420/kanban",
    );
  });

  test("rejects non-http external URL schemes", () => {
    expect(() => validateExternalBrowserUrl("javascript:alert(1)")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("file:///tmp/secret.txt")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
  });

  test("rejects malformed or relative external URLs", () => {
    expect(() => validateExternalBrowserUrl("/relative/path")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("not a url")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
  });
});
