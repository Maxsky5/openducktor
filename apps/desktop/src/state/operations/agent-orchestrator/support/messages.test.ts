import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { upsertMessage } from "./messages";

describe("agent-orchestrator/support/messages", () => {
  test("upserts messages by id", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "m1",
        role: "system",
        content: "old",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
    ];

    const appended = upsertMessage(messages, {
      id: "m2",
      role: "system",
      content: "new",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    expect(appended).toHaveLength(2);

    const replaced = upsertMessage(appended, {
      id: "m1",
      role: "system",
      content: "updated",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    expect(replaced).toHaveLength(2);
    expect(replaced[0]?.content).toBe("updated");
  });
});
