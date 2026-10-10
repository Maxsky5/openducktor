import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { Effect } from "effect";
import type { z } from "zod";
import type { AgentSessionLiveRef } from "@openducktor/contracts";

export type ClaudeLiveRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

type ClaudeRuntimeValidationDetails =
  | { readonly runtimeId: string; readonly runtimeKind: RuntimeKind }
  | { readonly runtimeId: string };

type OperationValidationDetails = { readonly operation: string };

export const toClaudeLiveSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

export const requireClaudeHostServiceRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<
  ClaudeLiveRuntimeInstance,
  HostValidationError<ClaudeRuntimeValidationDetails>
> => {
  if (runtime.kind !== "claude" || runtime.runtimeRoute.type !== "host_service") {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
        field: "runtime",
        message: `Claude live-session adapter requires a Claude host-service runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
        field: "runtime.runtimeRoute.identity",
        message: `Claude runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed({
    ...runtime,
    kind: "claude",
    runtimeRoute: {
      type: "host_service",
      identity: runtime.runtimeRoute.identity,
    },
  });
};

export const parseClaudeLiveSessionOutput = <Schema extends z.ZodType, Input>(
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
