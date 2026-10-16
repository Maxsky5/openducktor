import { describe, expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { buildSession } from "./session-actions.test-helpers";
import { createContinueInterruptedTurn } from "./continue-interrupted-turn";

type ContinuationAdapter = Pick<AgentEnginePort, "continueInterruptedTurn">;

const identity: AgentSessionIdentity = {
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  externalSessionId: "session-1",
};

const buildDependencies = ({
  session,
  continueInterruptedTurn,
}: {
  session: AgentSessionState | null;
  continueInterruptedTurn: ContinuationAdapter["continueInterruptedTurn"];
}) => {
  const calls: unknown[] = [];
  const preparedContexts: boolean[] = [];
  return {
    calls,
    preparedContexts,
    continueInterruptedTurn: createContinueInterruptedTurn({
      workspaceRepoPath: "/tmp/repo",
      adapter: {
        continueInterruptedTurn: (input) => {
          calls.push(input);
          return continueInterruptedTurn(input);
        },
      },
      readSessionSnapshot: () => session,
    }),
  };
};

describe("createContinueInterruptedTurn", () => {
  test("sends only session identity and workflow scope", async () => {
    const session = buildSession({
      status: "error",
      selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    });
    const { calls, continueInterruptedTurn } = buildDependencies({
      session,
      continueInterruptedTurn: async () => ({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:10:00.000Z",
        status: "running",
      }),
    });

    await continueInterruptedTurn(identity);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });
  });

  test("leaves workflow prompt preparation to the host", async () => {
    const session = buildSession({ status: "error" });
    const { calls, preparedContexts, continueInterruptedTurn } = buildDependencies({
      session,
      continueInterruptedTurn: async () => ({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:10:00.000Z",
        status: "running",
      }),
    });

    await continueInterruptedTurn(identity);

    expect(preparedContexts).toEqual([]);
    expect(calls[0]).not.toHaveProperty("systemPrompt");
  });

  test("omits the prompt when the preparation returns none", async () => {
    const { calls, preparedContexts, continueInterruptedTurn } = buildDependencies({
      session: buildSession({ status: "error" }),
      continueInterruptedTurn: async () => ({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:10:00.000Z",
        status: "running",
      }),
    });

    await continueInterruptedTurn(identity);

    expect(preparedContexts).toEqual([]);
    expect(calls[0]).not.toHaveProperty("systemPrompt");
  });

  test("omits the model when the session has no selection", async () => {
    const { calls, continueInterruptedTurn } = buildDependencies({
      session: buildSession({ status: "error", selectedModel: null }),
      continueInterruptedTurn: async () => ({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:10:00.000Z",
        status: "running",
      }),
    });

    await continueInterruptedTurn(identity);

    expect(calls[0]).not.toHaveProperty("model");
  });

  test("leaves the transcript and activity state untouched", async () => {
    const session = buildSession({ status: "error", messages: [] });
    const { continueInterruptedTurn } = buildDependencies({
      session,
      continueInterruptedTurn: async () => ({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:10:00.000Z",
        status: "running",
      }),
    });

    await continueInterruptedTurn(identity);

    expect(session.messages.items).toEqual([]);
    expect(session.status).toBe("error");
  });

  test("keeps the typed host failure intact when the runtime rejects the continuation", async () => {
    const failure = new HostInvokeError("Continuation refused", {
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "completed_turn",
        sessionRef: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "session-1",
        },
        operation: "agent-session.continue-interrupted-turn",
        message: "OpenCode session 'session-1' has a completed latest turn.",
        nextAction: "Send a new message to start new work.",
      },
    });
    const { continueInterruptedTurn } = buildDependencies({
      session: buildSession({ status: "error" }),
      continueInterruptedTurn: async () => {
        throw failure;
      },
    });

    await expect(continueInterruptedTurn(identity)).rejects.toBe(failure);
  });

  test("rejects a stale continuation when the session is no longer loaded", async () => {
    const { calls, continueInterruptedTurn } = buildDependencies({
      session: null,
      continueInterruptedTurn: async () => {
        throw new Error("must not reach the runtime");
      },
    });

    await expect(continueInterruptedTurn(identity)).rejects.toThrow(
      "Session 'session-1' is no longer loaded. Reload the session, then retry Resume.",
    );

    expect(calls).toHaveLength(0);
  });
});
