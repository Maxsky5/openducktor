import type {
  OpencodeLiveSessionContextUsage,
  OpencodeLiveSessionSnapshot,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionControlSummary,
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionContextUsageSchema,
  agentSessionControlSummarySchema,
  agentSessionLivePendingApprovalRequestSchema,
  agentSessionLivePendingQuestionRequestSchema,
  agentSessionLiveSnapshotSchema,
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

const toPendingApproval = (
  request: OpencodeLiveSessionSnapshot["pendingApprovals"][number],
): Effect.Effect<AgentSessionLivePendingApprovalRequest, HostValidationError> => {
  const { metadata: _metadata, requestInstanceId: _requestInstanceId, ...publicRequest } = request;
  return parseOutput(
    agentSessionLivePendingApprovalRequestSchema,
    publicRequest,
    "opencode-live-session.normalize-approval",
  );
};

const toPendingQuestion = (
  request: OpencodeLiveSessionSnapshot["pendingQuestions"][number],
): Effect.Effect<AgentSessionLivePendingQuestionRequest, HostValidationError> => {
  const { requestInstanceId: _requestInstanceId, ...publicRequest } = request;
  return parseOutput(
    agentSessionLivePendingQuestionRequestSchema,
    publicRequest,
    "opencode-live-session.normalize-question",
  );
};

export const toContextUsage = (
  contextUsage: OpencodeLiveSessionContextUsage | null,
): Effect.Effect<AgentSessionContextUsage | null, HostValidationError> => {
  if (!contextUsage) {
    return Effect.succeed(null);
  }
  const model = contextUsage.model;
  return parseOutput(
    agentSessionContextUsageSchema,
    {
      totalTokens: contextUsage.totalTokens,
      ...(model?.providerId ? { providerId: model.providerId } : {}),
      ...(model?.modelId ? { modelId: model.modelId } : {}),
      ...(model?.variant ? { variant: model.variant } : {}),
      ...(model?.profileId ? { profileId: model.profileId } : {}),
    },
    "opencode-live-session.normalize-context",
  );
};

export const toLiveSnapshot = (
  snapshot: OpencodeLiveSessionSnapshot,
): Effect.Effect<AgentSessionLiveSnapshot, HostValidationError> =>
  Effect.gen(function* () {
    const pendingApprovals = yield* Effect.forEach(snapshot.pendingApprovals, toPendingApproval);
    const pendingQuestions = yield* Effect.forEach(snapshot.pendingQuestions, toPendingQuestion);
    const contextUsage = yield* toContextUsage(snapshot.contextUsage);
    return yield* parseOutput(
      agentSessionLiveSnapshotSchema,
      {
        ref: snapshot.ref,
        activity: snapshot.activity,
        title: snapshot.title,
        startedAt: snapshot.startedAt,
        ...(snapshot.parentExternalSessionId
          ? { parentExternalSessionId: snapshot.parentExternalSessionId }
          : {}),
        pendingApprovals,
        pendingQuestions,
        contextUsage,
      },
      "opencode-live-session.normalize-snapshot",
    );
  });

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

export const validateChangeOwnership = (
  runtime: OpenCodeRuntimeInstance,
  runtimeId: string,
  changeType: string,
  ref?: AgentSessionLiveRef,
): Effect.Effect<void, HostValidationError> => {
  const ownsRef = !ref || (ref.runtimeKind === "opencode" && ref.repoPath === runtime.repoPath);
  if (runtimeId === runtime.runtimeId && ownsRef) {
    return Effect.void;
  }
  return Effect.fail(
    new HostValidationError({
      field: "runtimeId",
      message: `OpenCode live-session change '${changeType}' does not belong to runtime '${runtime.runtimeId}' in repo '${runtime.repoPath}'.`,
      details: {
        runtimeId,
        expectedRuntimeId: runtime.runtimeId,
        expectedRepoPath: runtime.repoPath,
        changeType,
        ref,
      },
    }),
  );
};

export const toControlSummary = (
  summary: unknown,
): Effect.Effect<AgentSessionControlSummary, HostValidationError> =>
  parseOutput(
    agentSessionControlSummarySchema,
    summary,
    "opencode-live-session.normalize-control-summary",
  );
