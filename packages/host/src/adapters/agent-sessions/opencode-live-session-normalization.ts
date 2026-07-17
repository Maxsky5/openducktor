import type { OpencodeSessionContextUsage } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionControlSummary,
  type AgentSessionLiveRef,
  agentSessionContextUsageSchema,
  agentSessionControlSummarySchema,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

export type OpenCodeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "opencode";
  readonly runtimeRoute: { readonly type: "local_http"; readonly endpoint: string };
};

export const refsEqual = (left: AgentSessionLiveRef, right: AgentSessionLiveRef): boolean =>
  left.repoPath === right.repoPath &&
  left.runtimeKind === right.runtimeKind &&
  left.workingDirectory === right.workingDirectory &&
  left.externalSessionId === right.externalSessionId;

export const refKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");

export const toSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
  externalSessionId: ref.externalSessionId,
});

export const parseOutput = <Output>(
  schema: { parse(value: unknown): Output },
  value: unknown,
  operation: string,
): Effect.Effect<Output, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const toContextUsage = (
  contextUsage: OpencodeSessionContextUsage,
): AgentSessionContextUsage => {
  const model = contextUsage.model;
  try {
    return agentSessionContextUsageSchema.parse({
      totalTokens: contextUsage.totalTokens,
      ...(model?.providerId ? { providerId: model.providerId } : {}),
      ...(model?.modelId ? { modelId: model.modelId } : {}),
      ...(model?.variant ? { variant: model.variant } : {}),
      ...(model?.profileId ? { profileId: model.profileId } : {}),
    });
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
      details: { operation: "opencode-live-session.normalize-context" },
    });
  }
};

export const requireRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<OpenCodeRuntimeInstance, HostValidationError> => {
  if (runtime.kind !== "opencode") {
    return Effect.fail(
      new HostValidationError({
        field: "runtime.kind",
        message: `OpenCode live-session adapter cannot prepare runtime kind '${runtime.kind}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.type !== "local_http") {
    return Effect.fail(
      new HostValidationError({
        field: "runtime.runtimeRoute",
        message: `OpenCode live-session adapter requires a local_http runtime route, received '${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeRoute: runtime.runtimeRoute.type },
      }),
    );
  }
  return Effect.succeed(runtime as OpenCodeRuntimeInstance);
};

export const toControlSummary = (
  summary: unknown,
): Effect.Effect<AgentSessionControlSummary, HostValidationError> =>
  parseOutput(
    agentSessionControlSummarySchema,
    summary,
    "opencode-live-session.normalize-control-summary",
  );
