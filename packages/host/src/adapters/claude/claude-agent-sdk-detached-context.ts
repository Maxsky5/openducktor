import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionContextUsage } from "@openducktor/contracts";
import { readClaudeContextUsageFromQuery } from "./claude-agent-sdk-context-usage";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { INIT_TIMEOUT_MS, withTimeout } from "./claude-agent-sdk-utils";

export type ClaudeContextUsageQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => Pick<Query, "close" | "getContextUsage" | "initializationResult">;

export const loadClaudeDetachedSessionContextUsage = async (input: {
  claudeExecutablePath: string;
  createQuery: ClaudeContextUsageQueryFactory;
  externalSessionId: string;
  processEnv?: NodeJS.ProcessEnv;
  workingDirectory: string;
}): Promise<AgentSessionContextUsage | null> => {
  const queue = new AsyncInputQueue<SDKUserMessage>();
  let sdkQuery: ReturnType<ClaudeContextUsageQueryFactory> | undefined;
  try {
    sdkQuery = input.createQuery({
      prompt: queue,
      options: {
        ...buildClaudeAgentSdkBaseOptions({
          claudeExecutablePath: input.claudeExecutablePath,
          cwd: input.workingDirectory,
          processEnv: input.processEnv,
        }),
        resume: input.externalSessionId,
      },
    });
    await withTimeout(
      sdkQuery.initializationResult(),
      INIT_TIMEOUT_MS,
      "Claude Agent SDK session initialization timed out while loading context usage.",
    );
    const usage = await readClaudeContextUsageFromQuery(sdkQuery);
    return usage ? { totalTokens: usage.usedTokens, contextWindow: usage.maxTokens } : null;
  } finally {
    queue.close();
    sdkQuery?.close();
  }
};
