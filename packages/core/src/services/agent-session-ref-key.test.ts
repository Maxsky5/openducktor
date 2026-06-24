import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentSessionRef } from "../types/agent-orchestrator";
import {
  agentSessionRefKey,
  agentSessionRefsEqual,
  agentSessionRefsShareRuntimeStream,
  withAgentSessionRef,
} from "./agent-session-ref-key";

const sessionRef = (overrides: Partial<AgentSessionRef> = {}): AgentSessionRef => ({
  externalSessionId: "session-1",
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  ...overrides,
});

describe("agent-session-ref-key", () => {
  test("keys include repo, runtime, working directory, and external session", () => {
    expect(agentSessionRefKey(sessionRef())).not.toBe(
      agentSessionRefKey(sessionRef({ workingDirectory: "/repo/other-worktree" })),
    );
  });

  test("normalizes trailing path separators when comparing full session refs", () => {
    expect(
      agentSessionRefsEqual(
        sessionRef({ repoPath: "/repo/", workingDirectory: "/repo/worktree/" }),
        sessionRef({ repoPath: "/repo", workingDirectory: "/repo/worktree" }),
      ),
    ).toBe(true);
  });

  test("matches runtime streams across worktrees in the same repo and runtime", () => {
    expect(
      agentSessionRefsShareRuntimeStream(
        sessionRef({ workingDirectory: "/repo" }),
        sessionRef({ workingDirectory: "/repo/worktrees/session-1" }),
      ),
    ).toBe(true);
  });

  test("attaches a full session ref to agent events", () => {
    const event: AgentEvent = {
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
    };

    expect(withAgentSessionRef(sessionRef(), event)).toEqual({
      ...event,
      sessionRef: sessionRef(),
    });
  });
});
