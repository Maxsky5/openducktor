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
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";

export type OpenCodeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "opencode";
  readonly runtimeRoute: { readonly type: "local_http"; readonly endpoint: string };
};

type OpenCodeRuntimeValidationDetails =
  | {
      readonly runtimeId: string;
      readonly runtimeKind: Exclude<RuntimeInstanceSummary["kind"], "opencode">;
    }
  | {
      readonly runtimeId: string;
      readonly runtimeRoute: RuntimeInstanceSummary["runtimeRoute"]["type"];
    };

type OperationValidationDetails = { readonly operation: string };

const isOpenCodeRuntimeInstance = (
  runtime: RuntimeInstanceSummary,
): runtime is OpenCodeRuntimeInstance =>
  runtime.kind === "opencode" && runtime.runtimeRoute.type === "local_http";

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

export const parseOutput = <Schema extends z.ZodType, Input>(
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

export const toContextUsage = (
  contextUsage: OpencodeSessionContextUsage,
): AgentSessionContextUsage => {
  const model = contextUsage.model;
  try {
    const input: z.input<typeof agentSessionContextUsageSchema> = {
      totalTokens: contextUsage.totalTokens,
    };
    if (model?.providerId) input.providerId = model.providerId;
    if (model?.modelId) input.modelId = model.modelId;
    if (model?.variant) input.variant = model.variant;
    if (model?.profileId) input.profileId = model.profileId;
    return agentSessionContextUsageSchema.parse(input);
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
): Effect.Effect<
  OpenCodeRuntimeInstance,
  HostValidationError<OpenCodeRuntimeValidationDetails>
> => {
  if (isOpenCodeRuntimeInstance(runtime)) {
    return Effect.succeed(runtime);
  }
  if (runtime.kind !== "opencode") {
    return Effect.fail(
      new HostValidationError<OpenCodeRuntimeValidationDetails>({
        field: "runtime.kind",
        message: `OpenCode live-session adapter cannot prepare runtime kind '${runtime.kind}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  return Effect.fail(
    new HostValidationError<OpenCodeRuntimeValidationDetails>({
      field: "runtime.runtimeRoute",
      message: `OpenCode live-session adapter requires a local_http runtime route, received '${runtime.runtimeRoute.type}'.`,
      details: { runtimeId: runtime.runtimeId, runtimeRoute: runtime.runtimeRoute.type },
    }),
  );
};

export const toControlSummary = (
  summary: AgentSessionControlSummary,
): Effect.Effect<AgentSessionControlSummary, HostValidationError<OperationValidationDetails>> =>
  parseOutput(
    agentSessionControlSummarySchema,
    summary,
    "opencode-live-session.normalize-control-summary",
  );
