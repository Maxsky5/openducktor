import { describe, expect, test } from "bun:test";
import { createOpenCodeMessageId } from "./opencode-message-id";

const OPENCODE_MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

describe("opencode message ids", () => {
  test("creates OpenCode-shaped ascending message ids", () => {
    const first = createOpenCodeMessageId(1_234_567);
    const second = createOpenCodeMessageId(1_234_567);
    const third = createOpenCodeMessageId(1_234_568);

    expect(first).toMatch(OPENCODE_MESSAGE_ID_PATTERN);
    expect(second).toMatch(OPENCODE_MESSAGE_ID_PATTERN);
    expect(third).toMatch(OPENCODE_MESSAGE_ID_PATTERN);
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });
});
