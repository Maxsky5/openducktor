import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  agentJsonAnswerMismatch,
  agentJsonOutputSchema,
  type AgentJsonGenerationInput,
  type AgentJsonOutputSchema,
  type AgentTextGenerationInput,
} from "@openducktor/contracts";
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
 * The result of one Claude answer with no tools, no MCP servers, no hooks, and no saved session.
 * It loads the settings files as sessions do, so it uses the same provider and authentication
 * setup. The instructions replace the Claude Code system prompt. With `outputSchema`, Claude
 * constrains the answer to it and returns the value as `structured_output`.
 */
const answerClaude = async (
  input: AgentTextGenerationInput,
  outputSchema: AgentJsonOutputSchema | null,
  { claudeExecutablePath, processEnv, createQuery = query }: ClaudeTextRuntime,
  signal: AbortSignal,
): Promise<SDKResultSuccess> => {
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
    settings: { disableAllHooks: true },
    persistSession: false,
    maxTurns: 1,
  };
  if (input.model.variant !== undefined) options.effort = toClaudeEffort(input.model.variant);
  if (outputSchema !== null) options.outputFormat = { type: "json_schema", schema: outputSchema };
  const answer = createQuery({ prompt: input.prompt, options });
  try {
    for await (const message of answer) {
      if (message.type !== "result") continue;
      if (message.subtype === "success" && !message.is_error) return message;
      const reason = message.subtype === "success" ? message.result : message.errors.join(" ");
      throw new Error(`Claude did not generate the answer: ${reason || message.subtype}`);
    }
  } finally {
    answer.close();
  }
  throw new Error("Claude ended without an answer. Generate it again.");
};

/** The final text of one Claude answer. */
export const generateClaudeText = async (
  input: AgentTextGenerationInput,
  runtime: ClaudeTextRuntime,
  signal: AbortSignal,
): Promise<string> => (await answerClaude(input, null, runtime, signal)).result;

/** One Claude answer of `answerSchema`, which Claude constrains to its JSON Schema. */
export const generateClaudeJson = async <Answer>(
  input: AgentJsonGenerationInput<Answer>,
  runtime: ClaudeTextRuntime,
  signal: AbortSignal,
): Promise<Answer> => {
  const result = await answerClaude(
    input,
    agentJsonOutputSchema(input.answerSchema),
    runtime,
    signal,
  );
  if (result.structured_output === undefined)
    throw new Error(
      "Claude returned no structured answer for the output schema. Generate it again.",
    );
  const answer = input.answerSchema.safeParse(result.structured_output);
  if (!answer.success) throw agentJsonAnswerMismatch("Claude", answer.error);
  return answer.data;
};

export const createClaudeTextGeneration = (
  runtime: ClaudeTextRuntime,
): AgentTextGenerationPort => ({
  generate: (input) =>
    Effect.tryPromise({
      try: (signal) => generateClaudeText(input, runtime, signal),
      catch: (cause) => toHostOperationError(cause, "claudeRuntime.generateText"),
    }),
  generateJson: <Answer>(input: AgentJsonGenerationInput<Answer>) =>
    Effect.tryPromise({
      try: (signal) => generateClaudeJson(input, runtime, signal),
      catch: (cause) => toHostOperationError(cause, "claudeRuntime.generateJson"),
    }),
});
