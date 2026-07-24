import { describe, expect, mock, test } from "bun:test";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { loadClaudeDetachedSessionContextUsage } from "./claude-agent-sdk-detached-context";

const contextUsageResponse = {
  totalTokens: 176_005,
  maxTokens: 200_000,
} as Awaited<ReturnType<Query["getContextUsage"]>>;

describe("loadClaudeDetachedSessionContextUsage", () => {
  test("resumes an idle persisted session only to read its context usage", async () => {
    const close = mock(() => {});
    const initializationResult = mock(
      async () => ({}) as Awaited<ReturnType<Query["initializationResult"]>>,
    );
    const getContextUsage = mock(async () => contextUsageResponse);
    const createQuery = mock((_input: unknown) => ({
      close,
      getContextUsage,
      initializationResult,
    }));

    await expect(
      loadClaudeDetachedSessionContextUsage({
        claudeExecutablePath: "/usr/local/bin/claude",
        createQuery,
        externalSessionId: "session-1",
        processEnv: { HOME: "/home/user" },
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual({ totalTokens: 176_005, contextWindow: 200_000 });

    expect(createQuery).toHaveBeenCalledTimes(1);
    expect(createQuery.mock.calls[0]?.[0]).toMatchObject({
      options: {
        cwd: "/repo/worktree",
        env: {
          HOME: "/home/user",
          CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor",
        },
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        resume: "session-1",
      },
    });
    expect(createQuery.mock.calls[0]?.[0]).toMatchObject({
      prompt: { [Symbol.asyncIterator]: expect.any(Function) },
    });
    expect(initializationResult).toHaveBeenCalledTimes(1);
    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("closes the resumed query when the context read fails", async () => {
    const close = mock(() => {});
    const createQuery = mock((_input: unknown) => ({
      close,
      getContextUsage: async () => {
        throw new Error("context unavailable");
      },
      initializationResult: async () => ({}) as Awaited<ReturnType<Query["initializationResult"]>>,
    }));

    await expect(
      loadClaudeDetachedSessionContextUsage({
        claudeExecutablePath: "/usr/local/bin/claude",
        createQuery,
        externalSessionId: "session-1",
        workingDirectory: "/repo/worktree",
      }),
    ).rejects.toThrow("context unavailable");

    expect(close).toHaveBeenCalledTimes(1);
  });
});
