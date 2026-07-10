import { describe, expect, mock, test } from "bun:test";
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_CONTEXT_USAGE_TIMEOUT_MS,
  readClaudeContextUsageFromQuery,
} from "./claude-agent-sdk-context-usage";

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
