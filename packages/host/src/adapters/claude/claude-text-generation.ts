import { query, type Options, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTextGenerationInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { toClaudeEffort } from "./claude-effort";

export type ClaudeTextQueryFactory = (input: {
  prompt: string;
  options: Options;
}) => Pick<Query, "close"> & AsyncIterable<SDKMessage>;

type ClaudeTextRuntime = {
  claudeExecutablePath: string;
  processEnv?: NodeJS.ProcessEnv | undefined;
  createQuery?: ClaudeTextQueryFactory;
};

/**
 * One Claude answer with no tools, no MCP servers, no settings files, and no saved session.
 * The instructions replace the Claude Code system prompt.
 */
export const generateClaudeText = async (
  input: AgentTextGenerationInput,
  { claudeExecutablePath, processEnv, createQuery = query }: ClaudeTextRuntime,
  signal: AbortSignal,
): Promise<string> => {
  const abortController = new AbortController();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const options: Options = {
    ...buildClaudeAgentSdkBaseOptions({ claudeExecutablePath, cwd: input.repoPath, processEnv }),
    abortController,
    model: input.model.modelId,
    systemPrompt: input.instructions,
    tools: [],
    skills: [],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    persistSession: false,
    maxTurns: 1,
  };
  if (input.model.variant !== undefined) options.effort = toClaudeEffort(input.model.variant);
  const answer = createQuery({ prompt: input.prompt, options });
  try {
    for await (const message of answer) {
      if (message.type !== "result") continue;
      if (message.subtype === "success" && !message.is_error) return message.result;
      const reason = message.subtype === "success" ? message.result : message.errors.join(" ");
      throw new Error(`Claude did not generate the text: ${reason || message.subtype}`);
    }
  } finally {
    answer.close();
  }
  throw new Error("Claude ended without an answer. Generate the text again.");
};

export const createClaudeTextGeneration = (
  runtime: ClaudeTextRuntime,
): AgentTextGenerationPort => ({
  generate: (input) =>
    Effect.tryPromise({
      try: (signal) => generateClaudeText(input, runtime, signal),
      catch: (cause) => toHostOperationError(cause, "claudeRuntime.generateText"),
    }),
});
