import { expect, test } from "bun:test";
import { createOpenCodeMessageId } from "./opencode-message-id";

test("creates unique OpenCode message IDs in creation order", () => {
  const ids = Array.from({ length: 50 }, () => createOpenCodeMessageId());

  for (const id of ids) expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  expect(ids.toSorted()).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
});
