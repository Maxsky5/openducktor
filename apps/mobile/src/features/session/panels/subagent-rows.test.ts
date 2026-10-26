import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { listSessionSubagents } from "@openducktor/frontend-core/sessions/session-view/subagent-activity";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildSubagentRows, subagentsMenuDetail, subagentsSummaryLabel } from "./subagent-rows";

const parent = {
  externalSessionId: "parent",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
} as const;
const childKey = agentSessionIdentityKey({ ...parent, externalSessionId: "child-1" });

const subagent = (
  id: string,
  meta: Partial<Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "subagent" }>>,
): AgentChatMessage => ({
  id,
  role: "system",
  content: "",
  timestamp: "2026-10-19T10:00:00.000Z",
  meta: { kind: "subagent", partId: id, correlationKey: id, status: "running", ...meta },
});

const messages = (): AgentChatMessage[] => [
  subagent("explore", {
    agent: "explore",
    externalSessionId: "child-1",
    description: "Map the code",
  }),
  subagent("review", { status: "completed", startedAtMs: 0, endedAtMs: 2_500 }),
];

describe("buildSubagentRows", () => {
  test("opens a Subagent with a session and shows the pending input of that session", () => {
    const rows = buildSubagentRows(listSessionSubagents(messages()), parent, { [childKey]: 1 });
    expect(rows[0]).toMatchObject({
      key: "explore",
      name: "explore",
      statusLabel: "Waiting for input",
      tone: "warning",
      pendingInputCount: 1,
      active: true,
      summary: "Map the code",
      session: { externalSessionId: "child-1", runtimeKind: "opencode", workingDirectory: "/repo" },
    });
    expect(rows[1]).toMatchObject({
      name: "Subagent",
      statusLabel: "Completed",
      tone: "success",
      durationMs: 2_500,
      active: false,
      session: null,
    });
  });

  test("says how many Subagents wait for input", () => {
    const rows = buildSubagentRows(listSessionSubagents(messages()), parent, { [childKey]: 2 });
    expect(subagentsSummaryLabel(rows)).toBe("Subagents, 2, 1 active, 1 waiting for input");
    const idle = buildSubagentRows(listSessionSubagents(messages()).slice(1), parent, {});
    expect(subagentsSummaryLabel(idle)).toBe("Subagents, 1");
    expect(subagentsMenuDetail(rows)).toBe("2 · 1 waiting for input · 1 active");
    expect(subagentsMenuDetail(idle)).toBe("1");
  });
});
