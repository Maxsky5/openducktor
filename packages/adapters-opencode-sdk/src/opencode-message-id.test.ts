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

  test("matches OpenCode's millisecond timestamp prefix", () => {
    const id = createOpenCodeMessageId(Date.parse("2026-06-21T00:00:00.000Z"));

    expect(id).toMatch(OPENCODE_MESSAGE_ID_PATTERN);
    expect(id.slice(0, "msg_ee77a1c00001".length)).toBe("msg_ee77a1c00001");
  });

  test("sorts follow-up user ids after existing OpenCode runtime message ids", () => {
    const previousAssistant = "msg_ee77a1c00001AAAAAAAAAAAAAA";
    const followUp = createOpenCodeMessageId(Date.parse("2026-06-21T00:00:00.001Z"));

    expect(followUp).toMatch(OPENCODE_MESSAGE_ID_PATTERN);
    expect(followUp.slice(0, "msg_ee77a1c01001".length)).toBe("msg_ee77a1c01001");
    expect(previousAssistant < followUp).toBe(true);
  });
});
