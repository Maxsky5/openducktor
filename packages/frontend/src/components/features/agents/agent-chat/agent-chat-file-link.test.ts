import { expect, test } from "bun:test";
import {
  chatFileLinkSuffixes,
  validChatFileDestinations,
  invalidChatFileDestinations,
} from "./agent-chat-file-link.test-fixtures";
import { parseChatFileLink, resolveChatFileLink } from "./agent-chat-file-link";

const resolve = (href: string, rootPath: string | null) =>
  resolveChatFileLink(parseChatFileLink(href), rootPath);

test("opens an absolute transcript file outside the working directory", () => {
  expect(resolve("/tmp/screenshot.png", "/repo/task")).toEqual({
    kind: "file",
    file: { rootPath: "/tmp", relativePath: "screenshot.png", access: "local" },
  });
});

for (const [href, rootPath, relativePath] of [
  ["/tmp/screenshot.png", "/tmp", "screenshot.png"],
  ["file:///tmp/a%20b.md:42", "/tmp", "a b.md"],
  ["/report.md", "/", "report.md"],
  [String.raw`C:\reports\a.md`, String.raw`C:\reports`, "a.md"],
  [String.raw`C:\a.md`, "C:\\", "a.md"],
  ["file:///C:/a.md", "C:/", "a.md"],
] as const) {
  test(`resolves an absolute file without a working directory: ${href}`, () => {
    expect(resolve(href, null)).toEqual({
      kind: "file",
      file: { rootPath, relativePath, access: "local" },
    });
  });
}

test("keeps external and fragment destinations", () => {
  for (const href of ["https://example.com", "mailto:a@b.test", "javascript:alert(1)"])
    expect(resolve(href, null).kind).toBe("external");
  expect(resolve("#section", null).kind).toBe("fragment");
  expect(resolve("src/a", null).kind).toBe("invalid");
  expect(resolve("", "/repo/task").kind).toBe("invalid");
});

for (const [path, rootPath, relativePath] of validChatFileDestinations) {
  for (const suffix of chatFileLinkSuffixes) {
    test(`resolves file destination ${path}${suffix}`, () => {
      expect(resolve(path + suffix, rootPath)).toEqual({
        kind: "file",
        file: { rootPath, relativePath },
      });
    });
  }
}

for (const [href, rootPath, message] of invalidChatFileDestinations) {
  test(`rejects malformed destination with cause: ${href}`, () => {
    expect(resolve(href, rootPath)).toEqual({ kind: "invalid", message });
  });
}

for (const [href, workingDirectory, rootPath, relativePath] of [
  ["file:///tmp/a%20b.PNG:42", "/repo/task", "/tmp", "a b.PNG"],
  ["../report.md", "/repo/task", "/repo", "report.md"],
  ["src/../../report.md", "/repo/task", "/repo", "report.md"],
  ["/report.md", "/repo/task", "/", "report.md"],
  ["file:///D:/reports/a.md", "C:/repo/task", "D:/reports", "a.md"],
  ["C:/a.md", "C:/repo/task", "C:/", "a.md"],
  ["C:%5Crepo%5Ctask%5C%2e%2e%5Cother%5Ca.md", "C:/repo/task", String.raw`C:\repo\other`, "a.md"],
] as const) {
  test(`opens local transcript destination ${href}`, () => {
    expect(resolve(href, workingDirectory)).toEqual({
      kind: "file",
      file: { rootPath, relativePath, access: "local" },
    });
  });
}
