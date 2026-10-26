import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "./agent-session-identity";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
} from "./agent-session-options";

const createSession = (
  overrides: Partial<AgentSessionOptionSummary> = {},
): AgentSessionOptionSummary => ({
  externalSessionId: "shared-session",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree-a",
  startedAt: "2026-06-10T10:00:00.000Z",
  role: "build",
  activityState: "idle",
  ...overrides,
});

describe("agent session options", () => {
  test("recency ordering uses full session identity for same-time ties", () => {
    const first = createSession({ workingDirectory: "/repo/worktree-a" });
    const second = createSession({ workingDirectory: "/repo/worktree-b" });

    expect(compareAgentSessionRecency(first, second)).not.toBe(0);
  });

  test("role session sequence keeps same external id sessions distinct", () => {
    const first = createSession({ workingDirectory: "/repo/worktree-a" });
    const second = createSession({ workingDirectory: "/repo/worktree-b" });

    const sequenceByIdentity = buildRoleSessionSequenceByIdentity([first, second]);

    expect(sequenceByIdentity.size).toBe(2);
    expect(sequenceByIdentity.has(agentSessionIdentityKey(first))).toBe(true);
    expect(sequenceByIdentity.has(agentSessionIdentityKey(second))).toBe(true);
  });

  test("formats option descriptions from activity state", () => {
    expect(
      formatAgentSessionOptionDescription(
        createSession({ activityState: "starting", startedAt: "not-a-date" }),
      ),
    ).toBe("not-a-date · starting · shared-s");
  });

  test.each(["running", "idle", "waiting_input", "error"] as const)(
    "explains unavailable %s status without losing valid input or errors",
    (activityState) => {
      const description = formatAgentSessionOptionDescription(
        createSession({
          startedAt: "not-a-date",
          activityState,
          statusUnavailableReason: "Update Claude Code and reconnect the runtime.",
        }),
      );
      expect(description).toContain(
        "status unavailable: Update Claude Code and reconnect the runtime.",
      );
      if (activityState === "waiting_input") expect(description).toContain("waiting input");
      if (activityState === "error") expect(description).toContain("error");
      if (activityState === "running" || activityState === "idle")
        expect(description).not.toContain(` · ${activityState} · `);
    },
  );
});
