import { describe, expect, test } from "bun:test";
import { resolveChatFileLink } from "./agent-chat-file-link";

describe("chat file destinations", () => {
  for (const path of [
    "src/app.ts",
    "./src/app.ts",
    "/repo/task/src/app.ts",
    "file:///repo/task/src/app.ts",
  ]) {
    for (const suffix of ["", ":42", ":42:7", "#L42", "#L42-L50"]) {
      test(`${path}${suffix}`, () => {
        expect(resolveChatFileLink(path + suffix, "/repo/task")).toEqual({
          kind: "file",
          file: { rootPath: "/repo/task", relativePath: "src/app.ts" },
        });
      });
    }
  }
  for (const [href, path] of [
    ["a%20b.ts", "a b.ts"],
    ["%E6%96%87.ts", "文.ts"],
    ["a%3A42", "a:42"],
    ["a%23L42", "a#L42"],
    ["a%2520b", "a%20b"],
    ["src/../a", "a"],
  ] as const) {
    test(`decodes once: ${href}`, () => {
      expect(resolveChatFileLink(href!, "/repo/task")).toEqual({
        kind: "file",
        file: { rootPath: "/repo/task", relativePath: path },
      });
    });
  }
  for (const href of [
    "../a",
    "%2e%2e/a",
    "src/%2e%2e/%2e%2e/a",
    "/repo/task-other/a",
    "/repo/other/a",
    "/repo/task",
    "file://server/repo/task/a",
    "a?raw",
    "a#bad",
    "a:0",
    "a:42:0",
    "a#L4-L2",
    "a%00b",
    "a%ZZ",
    "",
    "src/",
    "C:/repo/a",
  ]) {
    test(`rejects ${href}`, () => {
      expect(resolveChatFileLink(href, "/repo/task").kind).toBe("invalid");
    });
  }
  test("keeps external and fragment destinations", () => {
    for (const href of ["https://example.com", "mailto:a@b.test", "javascript:alert(1)"])
      expect(resolveChatFileLink(href, null).kind).toBe("external");
    expect(resolveChatFileLink("#section", null).kind).toBe("fragment");
    expect(resolveChatFileLink("src/a", null).kind).toBe("invalid");
  });
  test("uses the task root and native Windows paths", () => {
    expect(resolveChatFileLink("src/a", "/repo/task2")).toEqual({
      kind: "file",
      file: { rootPath: "/repo/task2", relativePath: "src/a" },
    });
    for (const href of ["C:\\repo\\src\\a:42", "file:///C:/repo/src/a#L42", "src/a"])
      expect(resolveChatFileLink(href, "C:\\repo")).toEqual({
        kind: "file",
        file: { rootPath: "C:\\repo", relativePath: "src/a" },
      });
    expect(resolveChatFileLink("C:src/a", "C:\\repo").kind).toBe("invalid");
    expect(resolveChatFileLink("D:/repo/a", "C:\\repo").kind).toBe("invalid");
  });
});
