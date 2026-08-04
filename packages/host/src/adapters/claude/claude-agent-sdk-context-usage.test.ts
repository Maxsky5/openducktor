import { describe, expect, mock, test } from "bun:test";
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import type { HostOperationError } from "../../effect/host-errors";
import {
  CLAUDE_CONTEXT_USAGE_TIMEOUT_MS,
  flushClaudeLiveContextUsageRefresh,
  readClaudeContextUsageFromQuery,
  scheduleClaudeLiveContextUsageRefresh,
} from "./claude-agent-sdk-context-usage";
import { createClaudeSession, emptyClaudeQuery } from "./claude-agent-sdk-session-io.test-support";

describe("readClaudeContextUsageFromQuery", () => {
  test("allows real Claude SDK context usage control calls to take several seconds", () => {
    expect(CLAUDE_CONTEXT_USAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  test("returns native context usage from a live SDK query", async () => {
    const contextUsageResponse: SDKControlGetContextUsageResponse = {
      agents: [],
      apiUsage: null,
      categories: [],
      gridRows: [],
      isAutoCompactEnabled: false,
      maxTokens: 200_000,
      mcpTools: [],
      memoryFiles: [],
      model: "claude-sonnet-4-6",
      percentage: 47.5,
      rawMaxTokens: 200_000,
      totalTokens: 95_000,
    };
    const getContextUsage = mock(async () => {
      return contextUsageResponse;
    });
    const contextUsage = await readClaudeContextUsageFromQuery({ getContextUsage });

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(contextUsage).toEqual({
      usedTokens: 95_000,
      maxTokens: 200_000,
    });
  });
});

describe("Claude live context usage refresh", () => {
  test("reports event publication failures through the background failure channel", async () => {
    const contextRead = Promise.withResolvers<{
      maxTokens: number;
      totalTokens: number;
    }>();
    const backgroundFailures: HostOperationError[] = [];
    const publicationError = new Error("Claude live-session adapter was released.");
    const session = createClaudeSession({
      query: Object.assign(emptyClaudeQuery(), {
        getContextUsage: () => contextRead.promise,
      }),
    });

    scheduleClaudeLiveContextUsageRefresh({
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      emit: () => {
        throw publicationError;
      },
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          backgroundFailures.push(failure);
        }),
    });
    const flushPromise = flushClaudeLiveContextUsageRefresh(session);

    contextRead.reject(new Error("Claude context query was closed."));

    await expect(flushPromise).rejects.toBe(publicationError);
    await Promise.resolve();
    expect(backgroundFailures).toEqual([
      expect.objectContaining({
        operation: "claudeRuntime.refreshLiveContextUsage",
        cause: publicationError,
      }),
    ]);
  });
});
