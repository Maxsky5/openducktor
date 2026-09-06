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
    "file:42",
    "README.md:-1",
    "README.md:42:no",
    "README.md:0",
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
    expect(resolveChatFileLink("C:42", "C:/repo").kind).toBe("invalid");
    expect(resolveChatFileLink("C:src/a", "C:\\repo").kind).toBe("invalid");
    expect(resolveChatFileLink("D:/repo/a", "C:\\repo").kind).toBe("invalid");
  });
});

for (const [path, rootPath, relativePath] of [
  [String.raw`C:\repo\task\src\app.ts`, "C:/Repo/Task", "src/app.ts"],
  ["C:%5Crepo%5Ctask%5Csrc%5Capp.ts", "C:/Repo/Task", "src/app.ts"],
  ["c:%5crepo%5ctask%5cSrc%5cApp.ts", "C:/Repo/Task", "Src/App.ts"],
  ["C:%2Frepo%2Ftask%2Fsrc%2Fapp.ts", "C:/Repo/Task", "src/app.ts"],
  ["c:/repo/src/app.ts", "C:/repo", "src/app.ts"],
  ["file:///%43:/repo/src/app.ts", "C:/repo", "src/app.ts"],
  ["C:/repo/task/src/app.ts", "C:/Repo/Task", "src/app.ts"],
  ["file:///C:/repo/task/src/app.ts", "C:/Repo/Task", "src/app.ts"],
  ["c:/rEpO/tAsK/Src/App.ts", "C:\\Repo\\Task", "Src/App.ts"],
  ["file:///%63:/rEpO/tAsK/Src/App.ts", "C:\\Repo\\Task", "Src/App.ts"],
] as const) {
  for (const suffix of ["", ":42", ":42:7", "#L42", "#L42-L50"]) {
    test(`resolves native Windows destination ${path}${suffix}`, () => {
      expect(resolveChatFileLink(path + suffix, rootPath)).toEqual({
        kind: "file",
        file: { rootPath, relativePath },
      });
    });
  }
}

test("drive comparison preserves file names and POSIX case boundaries", () => {
  expect(resolveChatFileLink("c:/repo/Src/App.ts", "C:/repo")).toEqual({
    kind: "file",
    file: { rootPath: "C:/repo", relativePath: "Src/App.ts" },
  });
  for (const href of ["/Repo/src/app.ts", "file:///Repo/src/app.ts"])
    expect(resolveChatFileLink(href, "/repo").kind).toBe("invalid");
  for (const href of ["d:/repo/src/app.ts", "file:///%44:/repo/src/app.ts"])
    expect(resolveChatFileLink(href, "C:/repo").kind).toBe("invalid");
});

for (const href of [
  "D:/repo/task/src/app.ts",
  "C:/repo/task-other/src/app.ts",
  "C:/repo/task/../other/src/app.ts",
  "file:///C:/repo/task/%2e%2e/other/src/app.ts",
  "C:/repo/src/app.ts",
]) {
  test(`Windows root comparison rejects outside paths: ${href}`, () => {
    expect(resolveChatFileLink(href, "C:/Repo/Task").kind).toBe("invalid");
  });
}

for (const href of [
  "C:42",
  "C:src/app.ts",
  "C:%255Crepo%5Ctask%5Csrc%5Capp.ts",
  "D:%5Crepo%5Ctask%5Csrc%5Capp.ts",
  "C:%5Crepo%5Ctask-other%5Csrc%5Capp.ts",
  "C:%5Crepo%5Ctask%5C%2e%2e%5Cother%5Capp.ts",
]) {
  test(`rejects invalid encoded Windows destination: ${href}`, () => {
    expect(resolveChatFileLink(href, "C:/repo/task").kind).toBe("invalid");
  });
}
