import { describe, expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { agentJsonOutputSchema } from "@openducktor/contracts";
import { z } from "zod";
import {
  generateClaudeJson,
  generateClaudeText,
  type ClaudeTextQueryFactory,
} from "./claude-text-generation";

const input = {
  repoPath: "/repo",
  model: {
    runtimeKind: "claude",
    providerId: "anthropic",
    modelId: "claude-haiku-5-5",
    variant: "low",
  },
  instructions: "Write one goal.",
  prompt: "Task: Add goals.",
} as const;

const fakeQuery = (messages: readonly Partial<SDKMessage>[]) => {
  const calls: { prompt: string; options: Options }[] = [];
  let closed = false;
  const createQuery: ClaudeTextQueryFactory = (request) => {
    calls.push(request);
    return {
      close: () => {
        closed = true;
      },
      async *[Symbol.asyncIterator]() {
        for (const message of messages) {
          // SAFETY: The fake messages hold every field that generateClaudeText reads.
          yield message as SDKMessage;
        }
      },
    };
  };
  return { createQuery, calls, closed: () => closed };
};

describe("generateClaudeText", () => {
  test("asks Claude once with no tools and no saved session, and returns the result", async () => {
    const claude = fakeQuery([
      { type: "assistant" },
      { type: "result", subtype: "success", is_error: false, result: "The goal." },
    ]);
    const text = await generateClaudeText(
      input,
      { claudeExecutablePath: "/bin/claude", createQuery: claude.createQuery },
      new AbortController().signal,
    );

    expect(text).toBe("The goal.");
    expect(claude.closed()).toBe(true);
    expect(claude.calls[0]?.prompt).toBe("Task: Add goals.");
    expect(claude.calls[0]?.options).toMatchObject({
      cwd: "/repo",
      model: "claude-haiku-5-5",
      effort: "low",
      systemPrompt: "Write one goal.",
      tools: [],
      skills: [],
      mcpServers: {},
      strictMcpConfig: true,
      settings: { disableAllHooks: true },
      persistSession: false,
      maxTurns: 1,
    });
    expect(claude.calls[0]?.options).not.toHaveProperty("settingSources");
    expect(claude.calls[0]?.options).not.toHaveProperty("outputFormat");
  });

  test("reports the Claude errors of a failed answer", async () => {
    const claude = fakeQuery([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Rate limit"] },
    ]);
    await expect(
      generateClaudeText(
        input,
        { claudeExecutablePath: "/bin/claude", createQuery: claude.createQuery },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Claude did not generate the answer: Rate limit");
    expect(claude.closed()).toBe(true);
  });
});

describe("generateClaudeJson", () => {
  const answerSchema = z.strictObject({ title: z.string() });

  test("constrains the answer to the JSON Schema of the answer and checks it", async () => {
    const claude = fakeQuery([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: '{"title":"Login fix"}',
        structured_output: { title: "Login fix" },
      },
    ]);
    const answer = await generateClaudeJson(
      { ...input, answerSchema },
      { claudeExecutablePath: "/bin/claude", createQuery: claude.createQuery },
      new AbortController().signal,
    );

    expect(answer).toEqual({ title: "Login fix" });
    expect(claude.calls[0]?.options.outputFormat).toEqual({
      type: "json_schema",
      schema: agentJsonOutputSchema(answerSchema),
    });
    expect(claude.calls[0]?.options).toMatchObject({ tools: [], maxTurns: 1 });
  });

  test.each([
    [
      "no structured output",
      undefined,
      "Claude returned no structured answer for the output schema.",
    ],
    [
      "a structured output of another shape",
      { name: "Login fix" },
      "does not fit the output schema",
    ],
  ])("fails with %s", async (_case, structuredOutput, message) => {
    const claude = fakeQuery([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Login fix",
        structured_output: structuredOutput,
      },
    ]);
    await expect(
      generateClaudeJson(
        { ...input, answerSchema },
        { claudeExecutablePath: "/bin/claude", createQuery: claude.createQuery },
        new AbortController().signal,
      ),
    ).rejects.toThrow(message);
  });
});
