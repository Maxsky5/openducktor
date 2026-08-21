import {
  type Options,
  type Query,
  query,
  type SDKControlInitializeResponse,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { JsonValue } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import { useRuntimeProbeResource } from "../runtimes/runtime-executable-probe-lifecycle";

const DEFAULT_INITIALIZATION_TIMEOUT_MS = 10_000;

type ClaudeProbeQuery = Pick<Query, "initializationResult" | "return">;
type ClaudeQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ClaudeProbeQuery;

const isClaudeInitializationResponse = (
  response: JsonValue | undefined,
): response is SDKControlInitializeResponse =>
  typeof response === "object" &&
  response !== null &&
  "commands" in response &&
  Array.isArray(response.commands) &&
  "agents" in response &&
  Array.isArray(response.agents) &&
  "output_style" in response &&
  typeof response.output_style === "string" &&
  "available_output_styles" in response &&
  Array.isArray(response.available_output_styles) &&
  "models" in response &&
  Array.isArray(response.models);

const createIdlePrompt = (signal: AbortSignal): AsyncIterable<SDKUserMessage> => ({
  [Symbol.asyncIterator]() {
    return {
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          if (signal.aborted) {
            resolve({ done: true, value: undefined });
            return;
          }
          signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), {
            once: true,
          });
        }),
    };
  },
});

export const buildClaudeExecutableProbeOptions = ({
  executablePath,
  processEnv,
  abortController,
}: {
  executablePath: string;
  processEnv: NodeJS.ProcessEnv;
  abortController: AbortController;
}): Options => ({
  abortController,
  allowedTools: [],
  cwd: process.cwd(),
  env: {
    ...processEnv,
    CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor/runtime-probe",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  },
  mcpServers: {},
  pathToClaudeCodeExecutable: executablePath,
  persistSession: false,
  settingSources: [],
  strictMcpConfig: true,
  tools: [],
});

export type CreateClaudeExecutableProbeInput = {
  initializationTimeoutMs?: number;
  processEnv?: NodeJS.ProcessEnv;
  queryFactory?: ClaudeQueryFactory;
};

export const createClaudeExecutableProbe = ({
  initializationTimeoutMs = DEFAULT_INITIALIZATION_TIMEOUT_MS,
  processEnv = process.env,
  queryFactory = (input) => query(input),
}: CreateClaudeExecutableProbeInput = {}): RuntimeExecutableProbePort => ({
  probeExecutable(executablePath) {
    const abortController = new AbortController();
    return useRuntimeProbeResource({
      acquire: Effect.try({
        try: () =>
          queryFactory({
            prompt: createIdlePrompt(abortController.signal),
            options: buildClaudeExecutableProbeOptions({
              executablePath,
              processEnv,
              abortController,
            }),
          }),
        catch: (cause) =>
          toHostOperationError(cause, "claudeExecutableProbe.start", { executablePath }),
      }),
      probe: (sdkQuery) =>
        Effect.tryPromise({
          try: () => sdkQuery.initializationResult(),
          catch: (cause) =>
            toHostOperationError(cause, "claudeExecutableProbe.initialize", { executablePath }),
        }).pipe(
          Effect.filterOrFail(
            isClaudeInitializationResponse,
            () =>
              new RuntimeExecutableIncompatibleError({
                message: `The executable at ${executablePath} returned an invalid Claude Agent SDK initialization response.`,
              }),
          ),
          Effect.timeoutFail({
            duration: `${initializationTimeoutMs} millis`,
            onTimeout: () =>
              new HostOperationError({
                operation: "claudeExecutableProbe.initialize",
                message: `Timed out initializing Claude Agent SDK with ${executablePath}.`,
                details: { executablePath, initializationTimeoutMs },
              }),
          }),
          Effect.asVoid,
        ),
      release: (sdkQuery) =>
        Effect.tryPromise({
          try: async () => {
            abortController.abort();
            await sdkQuery.return(undefined);
          },
          catch: (cause) =>
            toHostOperationError(cause, "claudeExecutableProbe.close", { executablePath }),
        }),
      cleanupOperation: "claudeExecutableProbe.cleanup",
    });
  },
});
