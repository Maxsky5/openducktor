import {
  type Options,
  type Query,
  query,
  type SDKControlInitializeResponse,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, toHostOperationError } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import {
  incompatibleRuntimeExecutableMessage,
  notReadyWithin,
  runtimeExecutableStartError,
} from "../runtimes/runtime-executable-guidance";
import { useRuntimeProbeResource } from "../runtimes/runtime-executable-probe-lifecycle";
import { CLAUDE_CODE_GUIDANCE, getClaudeCodeCompatibilityError } from "./claude-code-compatibility";
import { withOpenDucktorClaudeCodeEnv } from "./claude-code-process-env";

const DEFAULT_INITIALIZATION_TIMEOUT_MS = 10_000;
const claudeInitializationResponseSchema = z.object({
  agents: z.array(z.unknown()),
  available_output_styles: z.array(z.unknown()),
  commands: z.array(z.unknown()),
  models: z.array(z.unknown()),
  output_style: z.string(),
});

type ClaudeProbeQuery = Pick<Query, "initializationResult" | "return">;
type ClaudeQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ClaudeProbeQuery;

const isClaudeInitializationResponse = (
  response: SDKControlInitializeResponse,
): response is SDKControlInitializeResponse =>
  claudeInitializationResponseSchema.safeParse(response).success;

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
    ...withOpenDucktorClaudeCodeEnv(processEnv, "openducktor/runtime-probe"),
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
  readEnv?: () => NodeJS.ProcessEnv;
  queryFactory?: ClaudeQueryFactory;
};

export const createClaudeExecutableProbe = ({
  initializationTimeoutMs = DEFAULT_INITIALIZATION_TIMEOUT_MS,
  readEnv = () => process.env,
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
              processEnv: readEnv(),
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
            runtimeExecutableStartError({
              guidance: CLAUDE_CODE_GUIDANCE,
              operation: "claudeExecutableProbe.initialize",
              executablePath,
              detail: errorMessage(cause),
              cause,
            }),
        }).pipe(
          Effect.filterOrFail(
            isClaudeInitializationResponse,
            () =>
              new RuntimeExecutableIncompatibleError({
                message: incompatibleRuntimeExecutableMessage(
                  CLAUDE_CODE_GUIDANCE,
                  executablePath,
                  "returned an invalid Claude Agent SDK initialization response",
                ),
              }),
          ),
          Effect.flatMap((initialization) => {
            const compatibilityError = getClaudeCodeCompatibilityError(
              initialization,
              executablePath,
            );
            return compatibilityError ? Effect.fail(compatibilityError) : Effect.void;
          }),
          Effect.timeoutOrElse({
            duration: `${initializationTimeoutMs} millis`,
            orElse: () =>
              Effect.fail(
                runtimeExecutableStartError({
                  guidance: CLAUDE_CODE_GUIDANCE,
                  operation: "claudeExecutableProbe.initialize",
                  executablePath,
                  detail: notReadyWithin(initializationTimeoutMs),
                }),
              ),
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
