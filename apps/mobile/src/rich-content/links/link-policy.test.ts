import { describe, expect, test } from "bun:test";
import { classifyLink } from "./link-policy";

describe("classifyLink", () => {
  test("opens web and email links", () => {
    expect(classifyLink("https://example.com/a?b=1")).toEqual({
      kind: "external",
      url: "https://example.com/a?b=1",
    });
    expect(classifyLink(" http://example.com ")).toEqual({
      kind: "external",
      url: "http://example.com/",
    });
    expect(classifyLink("mailto:team@example.com")).toEqual({
      kind: "external",
      url: "mailto:team@example.com",
    });
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,x",
    "tel:123",
    "vbscript:x",
  ])("rejects %s with a reason", (href) => {
    expect(classifyLink(href)).toEqual({
      kind: "rejected",
      reason: "This kind of link does not open on this device. Web, email, and file links open.",
    });
  });

  test("rejects empty, fragment, and malformed links with a reason", () => {
    expect(classifyLink("  ")).toEqual({
      kind: "rejected",
      reason: "The link has no destination.",
    });
    expect(classifyLink("#intro").kind).toBe("rejected");
    expect(classifyLink("mailto:").kind).toBe("rejected");
    expect(classifyLink("https://").kind).toBe("rejected");
    expect(classifyLink("https://exa\u0000mple.com").kind).toBe("rejected");
  });

  test("reads file links with the shared chat file-link rules", () => {
    expect(classifyLink("src/app.ts")).toEqual({ kind: "file", path: "src/app.ts" });
    expect(classifyLink("src/app.ts:42")).toEqual({ kind: "file", path: "src/app.ts" });
    expect(classifyLink("src/app.ts:42:7")).toEqual({ kind: "file", path: "src/app.ts" });
    expect(classifyLink("/repo/src/app%20one.ts#L3-L9")).toEqual({
      kind: "file",
      path: "/repo/src/app one.ts",
    });
    expect(classifyLink("README.md:12")).toEqual({ kind: "file", path: "README.md" });
    expect(classifyLink("C:\\repo\\main.rs")).toEqual({ kind: "file", path: "C:\\repo\\main.rs" });
    expect(classifyLink("file:///repo/a.md")).toEqual({ kind: "file", path: "/repo/a.md" });
  });

  test("rejects file links that do not name a file", () => {
    expect(classifyLink("src/")).toEqual({
      kind: "rejected",
      reason: "The destination must name a file.",
    });
    expect(classifyLink("file://host/a.md").kind).toBe("rejected");
    expect(classifyLink("//server/share/a.md").kind).toBe("rejected");
    expect(classifyLink("src/..").kind).toBe("rejected");
    expect(classifyLink("src/a.ts?raw").kind).toBe("rejected");
    expect(classifyLink("src/a.ts#L9-L3").kind).toBe("rejected");
    expect(classifyLink("src/a.ts#heading").kind).toBe("rejected");
    expect(classifyLink("src/%E0%A4%A.ts").kind).toBe("rejected");
  });
});
