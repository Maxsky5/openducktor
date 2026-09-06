import { expect, test } from "bun:test";
import {
  chatFileLinkSuffixes,
  validChatFileDestinations,
  invalidChatFileDestinations,
} from "./agent-chat-file-link.test-fixtures";
import { resolveChatFileLink } from "./agent-chat-file-link";

test("keeps external and fragment destinations", () => {
  for (const href of ["https://example.com", "mailto:a@b.test", "javascript:alert(1)"])
    expect(resolveChatFileLink(href, null).kind).toBe("external");
  expect(resolveChatFileLink("#section", null).kind).toBe("fragment");
  expect(resolveChatFileLink("src/a", null).kind).toBe("invalid");
  expect(resolveChatFileLink("", "/repo/task").kind).toBe("invalid");
});

for (const [path, rootPath, relativePath] of validChatFileDestinations) {
  for (const suffix of chatFileLinkSuffixes) {
    test(`resolves file destination ${path}${suffix}`, () => {
      expect(resolveChatFileLink(path + suffix, rootPath)).toEqual({
        kind: "file",
        file: { rootPath, relativePath },
      });
    });
  }
}

for (const [href, rootPath, message] of invalidChatFileDestinations) {
  test(`rejects malformed destination with cause: ${href}`, () => {
    expect(resolveChatFileLink(href, rootPath)).toEqual({ kind: "invalid", message });
  });
}
