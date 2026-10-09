import { homedir } from "node:os";
import {
  query as createQuery,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  claudeBuiltinToolNameSchema,
  claudeToolName,
  type ClaudeToolCatalog,
  type ClaudeToolCatalogInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  toHostOperationError,
  type HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { INIT_TIMEOUT_MS, withTimeout } from "./claude-agent-sdk-utils";
import { disableLimit } from "./claude-tool-availability";

/** Global Settings needs its own query so catalog reads do not alter a live session. */
export const readClaudeToolCatalog = (
  input: ClaudeToolCatalogInput,
  runtime: { claudeExecutablePath: string; processEnv?: NodeJS.ProcessEnv | undefined },
): Effect.Effect<ClaudeToolCatalog, HostOperationError | HostOperationErrorAggregate> =>
  Effect.tryPromise({
    try: (signal) =>
      loadClaudeToolCatalog({
        ...input,
        claudeExecutablePath: runtime.claudeExecutablePath,
        processEnv: runtime.processEnv,
        createQuery,
        signal,
      }),
    catch: (cause) => toHostOperationError(cause, "claudeRuntime.loadToolCatalog"),
  });

export type ClaudeToolCatalogQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => Pick<Query, "close" | "initializationResult"> & AsyncIterable<SDKMessage>;

export const loadClaudeToolCatalog = async (input: {
  runtimeId: string;
  claudeExecutablePath: string;
  processEnv?: NodeJS.ProcessEnv | undefined;
  createQuery: ClaudeToolCatalogQueryFactory;
  signal: AbortSignal;
}): Promise<ClaudeToolCatalog> => {
  input.signal.throwIfAborted();
  const queue = new AsyncInputQueue<SDKUserMessage>();
  const abortController = new AbortController();
  let query: ReturnType<ClaudeToolCatalogQueryFactory> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    abortController.abort();
    queue.close();
    query?.close();
  };
  input.signal.addEventListener("abort", close, { once: true });
  try {
    query = input.createQuery({
      prompt: queue,
      options: {
        ...buildClaudeAgentSdkBaseOptions({
          claudeExecutablePath: input.claudeExecutablePath,
          cwd: homedir(),
          processEnv: input.processEnv,
        }),
        persistSession: false,
        abortController,
        // Approval handling exposes interactive tools in native init. This read
        // has no session that can approve their execution.
        canUseTool: async () => ({
          behavior: "deny",
          message: "Tool execution is unavailable during a Claude tool catalog read.",
        }),
      },
    });
    const initialization = await withTimeout(
      query.initializationResult(),
      INIT_TIMEOUT_MS,
      "Claude tool catalog initialization timed out. Check Claude authentication and retry.",
    );
    input.signal.throwIfAborted();
    if (!initialization.commands.some((command) => command.name === "context" && command.builtin)) {
      throw new Error(
        "Claude did not advertise the built-in context command. Update Claude Code and retry the tool catalog read.",
      );
    }
    // Native init lists all tools, including deferred tools. A local command starts
    // the stream without a model prompt; context usage omits the tool-name fields.
    queue.push({
      type: "user",
      message: { role: "user", content: "/context" },
      parent_tool_use_id: null,
      session_id: "",
    });
    const nativeNames = await withTimeout(
      readToolNames(query),
      INIT_TIMEOUT_MS,
      "Claude tool catalog read timed out. Check Claude connectivity and retry.",
    );
    input.signal.throwIfAborted();
    const names = new Set<string>();
    for (const nativeName of nativeNames) {
      if (nativeName.startsWith("mcp__")) continue;
      const name = claudeBuiltinToolNameSchema.safeParse(nativeName);
      if (!name.success)
        throw new Error(
          `Claude returned an invalid built-in tool name '${nativeName}'. Update Claude Code and retry.`,
        );
      names.add(claudeToolName(name.data));
    }
    return {
      runtimeKind: "claude",
      runtimeId: input.runtimeId,
      tools: [...names].sort().map((name) => {
        const limitation = disableLimit(name);
        return limitation ? { name, canDisable: false, limitation } : { name, canDisable: true };
      }),
    };
  } finally {
    input.signal.removeEventListener("abort", close);
    close();
  }
};

const readToolNames = async (query: AsyncIterable<SDKMessage>): Promise<string[]> => {
  const stream = query[Symbol.asyncIterator]();
  for (let next = await stream.next(); !next.done; next = await stream.next()) {
    const message = next.value;
    if (message.type === "system" && message.subtype === "init") {
      const names = z.array(z.string()).safeParse(message.tools);
      if (!names.success) {
        throw new Error("Claude returned invalid tool metadata. Update Claude Code and retry.");
      }
      return names.data;
    }
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error(
        `Claude tool catalog failed: ${message.errors.join(" ")} Check Claude authentication and retry.`,
      );
    }
  }
  throw new Error("Claude did not return tool metadata. Update Claude Code and retry.");
};
