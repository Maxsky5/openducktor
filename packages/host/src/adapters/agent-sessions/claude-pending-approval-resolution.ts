import { Effect } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
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
