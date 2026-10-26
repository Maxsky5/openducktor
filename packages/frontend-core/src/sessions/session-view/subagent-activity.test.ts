import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "../../types/agent-orchestrator";
import type { SubagentMeta } from "../messages/agent-chat-message-card-model.types";
import {
  isSubagentWaitingForInput,
  listSessionSubagents,
  readSubagentDurationMs,
  subagentDisplayName,
  subagentStatusLabel,
} from "./subagent-activity";

const subagentMeta = (overrides: Partial<SubagentMeta> = {}): SubagentMeta => ({
  kind: "subagent",
  partId: "part-1",
  correlationKey: "explore-1",
  status: "running",
  ...overrides,
});

const subagentMessage = (id: string, meta: SubagentMeta): AgentChatMessage => ({
  id,
  role: "system",
  content: "",
  timestamp: "2026-10-19T10:00:00.000Z",
  meta,
});

describe("subagent activity", () => {
  test("labels every status", () => {
    expect(subagentStatusLabel("pending")).toBe("Queued");
    expect(subagentStatusLabel("running")).toBe("Running");
    expect(subagentStatusLabel("completed")).toBe("Completed");
    expect(subagentStatusLabel("cancelled")).toBe("Cancelled");
    expect(subagentStatusLabel("error")).toBe("Failed");
  });

  test("names a Subagent without an agent name", () => {
    expect(subagentDisplayName({ agent: "  " })).toBe("Subagent");
    expect(subagentDisplayName({ agent: "explore" })).toBe("explore");
  });

  test("waits for input only while it runs with a session and a pending request", () => {
    const running = subagentMeta({ externalSessionId: "child-1" });
    expect(isSubagentWaitingForInput(running, 1)).toBe(true);
    expect(isSubagentWaitingForInput(running, 0)).toBe(false);
    expect(isSubagentWaitingForInput(subagentMeta(), 1)).toBe(false);
    expect(isSubagentWaitingForInput({ ...running, status: "completed" }, 1)).toBe(false);
  });

  test("reports a duration only for a finished Subagent", () => {
    expect(readSubagentDurationMs(subagentMeta({ startedAtMs: 1, endedAtMs: 5 }))).toBeNull();
    expect(
      readSubagentDurationMs(subagentMeta({ status: "completed", startedAtMs: 1, endedAtMs: 5 })),
    ).toBe(4);
  });

  test("keeps the first position and the latest state of each Subagent", () => {
    const messages = [
      subagentMessage("a", subagentMeta({ correlationKey: "a", status: "pending" })),
      subagentMessage("b", subagentMeta({ correlationKey: "b" })),
      subagentMessage("a2", subagentMeta({ correlationKey: "a", status: "completed" })),
    ];
    expect(listSessionSubagents(messages).map(({ key, meta }) => [key, meta.status])).toEqual([
      ["a", "completed"],
      ["b", "running"],
    ]);
  });
});
