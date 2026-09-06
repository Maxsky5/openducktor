import { expect, test } from "bun:test";
import {
  chatFileLinkSuffixes,
  validChatFileDestinations,
  invalidChatFileDestinations,
} from "./agent-chat-file-link.test-fixtures";
import { parseChatFileLink, resolveChatFileLink } from "./agent-chat-file-link";

const resolve = (href: string, rootPath: string | null) =>
  resolveChatFileLink(parseChatFileLink(href), rootPath);

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
