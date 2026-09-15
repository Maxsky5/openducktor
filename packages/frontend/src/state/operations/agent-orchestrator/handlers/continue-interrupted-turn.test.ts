import { describe, expect, test } from "bun:test";
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
  return {
    calls,
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
  test("sends the session identity, workflow scope, and selected model", async () => {
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
      model: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    });
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

  test("reports the session id when the runtime rejects the continuation", async () => {
    const { continueInterruptedTurn } = buildDependencies({
      session: buildSession({ status: "error" }),
      continueInterruptedTurn: async () => {
        throw new Error("continuation refused");
      },
    });

    await expect(continueInterruptedTurn(identity)).rejects.toThrow(
      "Failed to continue the interrupted turn for session 'session-1': continuation refused",
    );
  });

  test("does nothing when the session is not loaded", async () => {
    const { calls, continueInterruptedTurn } = buildDependencies({
      session: null,
      continueInterruptedTurn: async () => {
        throw new Error("must not reach the runtime");
      },
    });

    await continueInterruptedTurn(identity);

    expect(calls).toHaveLength(0);
  });
});
