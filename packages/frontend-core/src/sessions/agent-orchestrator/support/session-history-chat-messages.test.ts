import { describe, expect, test } from "bun:test";
import { historyToChatMessages } from "./session-history-chat-messages";

describe("session history chat messages", () => {
  test("keeps the automation that sent a prompt", () => {
    const [message] = historyToChatMessages(
      [
        {
          messageId: "user-1",
          role: "user",
          timestamp: "2026-10-08T10:00:00.000Z",
          text: "Check the build",
          displayParts: [],
          state: "read",
          origin: { kind: "automation", name: "Nightly check" },
          parts: [],
        },
      ],
      { role: null },
    );
    expect(message).toMatchObject({
      role: "user",
      meta: { kind: "user", origin: { kind: "automation", name: "Nightly check" } },
    });
  });

  test("folds a titled system message under its title", () => {
    const [message] = historyToChatMessages(
      [
        {
          messageId: "system-1",
          role: "system",
          timestamp: "2026-10-08T10:00:00.000Z",
          text: "The plugin reloaded its tools.",
          title: "Plugin reloaded",
          parts: [],
        },
      ],
      { role: null },
    );
    expect(message).toMatchObject({
      role: "system",
      content: "The plugin reloaded its tools.",
      meta: { kind: "system", title: "Plugin reloaded" },
    });
  });
});
