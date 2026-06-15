import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
} from "./agent-session-options";

const createSession = (
  overrides: Partial<AgentSessionOptionSummary> = {},
): AgentSessionOptionSummary => ({
  externalSessionId: "shared-session",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree-a",
  startedAt: "2026-06-10T10:00:00.000Z",
  role: "build",
  status: "idle",
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
});
