import { type AgentSessionLiveRef, type RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";

export type CodexLiveRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "codex";
  readonly runtimeRoute: { readonly type: "stdio"; readonly identity: string };
};

type CodexRuntimeValidationDetails =
  | { readonly runtimeId: string; readonly runtimeKind: RuntimeInstanceSummary["kind"] }
  | { readonly runtimeId: string };

type OperationValidationDetails = { readonly operation: string };

const isCodexRuntimeInstance = (
  runtime: RuntimeInstanceSummary,
): runtime is CodexLiveRuntimeInstance =>
  runtime.kind === "codex" && runtime.runtimeRoute.type === "stdio";

export const toCodexLiveSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
  externalSessionId: ref.externalSessionId,
});

export const parseCodexLiveSessionOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<OperationValidationDetails>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError<OperationValidationDetails>({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const requireCodexStdioRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<CodexLiveRuntimeInstance, HostValidationError<CodexRuntimeValidationDetails>> => {
  if (!isCodexRuntimeInstance(runtime)) {
    return Effect.fail(
      new HostValidationError<CodexRuntimeValidationDetails>({
        field: "runtime",
        message: `Codex live-session adapter requires a Codex stdio runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError<CodexRuntimeValidationDetails>({
        field: "runtime.runtimeRoute.identity",
        message: `Codex runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed(runtime);
};
