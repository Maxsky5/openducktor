import { Effect } from "effect";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionLiveAdapterPort,
  ApprovalReplyOptions,
} from "../../ports/agent-session-live-adapter-port";
import {
  type HostError,
  type HostOperationErrorAggregate,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  ClaudeAgentSdkService,
  ClaudePendingInputResolution,
} from "../../application/runtimes/claude-agent-sdk-service";
import { parseClaudeTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import type { createClaudeLiveSessionState } from "./claude-live-session-state";
import type { AgentSessionResumeNextActionOverrides } from "../../ports/agent-session-resume-error";
import { InterruptedTurnResumeError } from "@openducktor/core";

export const preAdmissionNextActionOverrides = (
  cause: unknown,
): AgentSessionResumeNextActionOverrides =>
  cause instanceof HostOperationError && cause.cause instanceof InterruptedTurnResumeError
    ? { continuation_failed: "Send a new message to continue." }
    : {};

export const createClaudePendingApprovalResolver =
  (
    service: Pick<ClaudeAgentSdkService, "resolvePendingApproval">,
    state: ReturnType<typeof createClaudeLiveSessionState>,
  ): AgentSessionLiveAdapterPort["resolvePendingApproval"] =>
  (input) =>
    service.resolvePendingApproval(input).pipe(
      Effect.flatMap((routing) =>
        Effect.try({
          try: () => {
            const observed = state.readSnapshot(routing.owner);
            const request =
              observed.type === "live"
                ? observed.session.pendingApprovals.find(
                    (request) => request.requestId === input.requestId,
                  )
                : undefined;
            if (!request)
              throw new HostValidationError({
                field: "requestId",
                message:
                  "The native approval owner is not registered with this pending request. Reload the runtime.",
              });
            return { ...routing, request };
          },
          catch: (cause) =>
            toHostOperationError(cause, "claude-live-session.resolve-pending-approval", {
              externalSessionId: input.externalSessionId,
            }),
        }),
      ),
    );

/**
 * Publishes the resolution of a pending approval or question, then answers the native request.
 * A failed publication rolls the snapshot back and leaves the request pending.
 */
export const createClaudePendingInputResolver =
  ({
    commit,
    runControlMutation,
    requireSessionContext,
    runtimeId,
    sessionError,
    state,
  }: {
    commit: <Value>(
      operation: string,
      mutation: () => AgentSessionLiveAdapterMutation<Value>,
    ) => Effect.Effect<Value, HostError>;
    runControlMutation: <Value>(
      effect: Effect.Effect<Value, HostError>,
    ) => Effect.Effect<Value, HostError>;
    requireSessionContext: (
      externalSessionId: string,
    ) => Effect.Effect<ClaudeSessionContext, HostError>;
    runtimeId: string;
    sessionError: (
      operation: string,
      externalSessionId: string,
    ) => (cause: unknown) => HostOperationErrorAggregate;
    state: ReturnType<typeof createClaudeLiveSessionState>;
  }) =>
  (
    operation: string,
    externalSessionId: string,
    prepare: Effect.Effect<ClaudePendingInputResolution, HostError>,
    options?: ApprovalReplyOptions,
  ): Effect.Effect<void, HostError> =>
    runControlMutation(
      prepare.pipe(
        Effect.mapError(sessionError(operation, externalSessionId)),
        Effect.flatMap((resolution) => {
          const rootExternalSessionId = parseClaudeTranscriptTarget(
            resolution.event.externalSessionId,
          ).sessionId;
          return requireSessionContext(rootExternalSessionId).pipe(
            Effect.flatMap((session) => {
              let rollback = () => {};
              return commit(`${operation}.publish`, () => {
                const applied = state.applyPendingResolution(session, resolution.event);
                rollback = applied.rollback;
                return {
                  value: resolution.complete,
                  changes: applied.changes,
                };
              }).pipe(
                Effect.tapError(() => Effect.sync(rollback)),
                Effect.flatMap((complete) =>
                  Effect.try({
                    try: () => {
                      options?.onIssued?.();
                      complete();
                    },
                    catch: (cause) =>
                      toHostOperationError(cause, `${operation}.complete`, {
                        runtimeId,
                        externalSessionId,
                      }),
                  }),
                ),
              );
            }),
          );
        }),
      ),
    );
