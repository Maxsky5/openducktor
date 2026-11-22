import type {
  AgentSessionLiveAllowDeniedActionInput,
  AgentSessionLiveReplyApprovalInput,
} from "@openducktor/contracts";
import type { ApprovalReplyOptions } from "../../ports/agent-session-live-adapter-port";
import { Effect, Exit } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

type CodexApprovalControlsInput = {
  readonly runtimeId: string;
  readonly controller: Pick<
    CodexSessionController,
    "replyLiveApproval" | "claimDeniedAction" | "allowDeniedAction" | "releaseDeniedActionClaim"
  >;
  readonly refreshProjection: () => Effect.Effect<unknown, HostError>;
  readonly sessionError: (
    operation: string,
    externalSessionId: string,
  ) => (cause: unknown) => HostError;
};

/**
 * Allows one call that Codex auto-review denied. Every client sees the request while it runs,
 * and the settled entry after it. A runtime failure makes Allow available again.
 */
const createCodexDeniedActionAllow =
  ({ runtimeId, controller, refreshProjection, sessionError }: CodexApprovalControlsInput) =>
  (input: AgentSessionLiveAllowDeniedActionInput): Effect.Effect<void, HostError> => {
    const locator = {
      runtimeId,
      externalSessionId: input.externalSessionId,
      callId: input.callId,
    };
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const claim = controller.claimDeniedAction(locator);
        if (claim.kind === "unavailable") {
          return yield* new HostValidationError({
            field: "callId",
            message: claim.message,
            details: { externalSessionId: input.externalSessionId, callId: input.callId },
          });
        }
        const allowed = yield* Effect.exit(
          refreshProjection().pipe(
            Effect.andThen(
              Effect.tryPromise({
                try: () => controller.allowDeniedAction(locator),
                catch: sessionError(
                  "codex-live-session.allow-denied-action",
                  input.externalSessionId,
                ),
              }),
            ),
          ),
        );
        if (Exit.isFailure(allowed)) {
          // The controller settles the entry itself once it sends the request.
          controller.releaseDeniedActionClaim(
            locator,
            "OpenDucktor could not send the approval to Codex. Try again.",
          );
        }
        yield* refreshProjection();
        return yield* allowed;
      }),
    );
  };

/** Answers Codex approval requests, and allows calls that Codex auto-review denied. */
export const createCodexApprovalControls = (input: CodexApprovalControlsInput) => {
  const { runtimeId, controller, refreshProjection, sessionError } = input;
  return {
    replyApproval: (
      approval: AgentSessionLiveReplyApprovalInput,
      options?: ApprovalReplyOptions,
    ): Effect.Effect<void, HostError> => {
      const request: Parameters<typeof controller.replyLiveApproval>[0] = {
        runtimeId,
        externalSessionId: approval.externalSessionId,
        requestId: approval.requestId,
        outcome: approval.outcome,
        onIssued: options?.onIssued,
        denialSource: options?.denialSource,
      };
      if (approval.message !== undefined) {
        request.message = approval.message;
      }
      return Effect.tryPromise({
        try: () => controller.replyLiveApproval(request),
        catch: sessionError("codex-live-session.reply-approval", approval.externalSessionId),
      }).pipe(Effect.tap(() => refreshProjection()));
    },
    allowDeniedAction: createCodexDeniedActionAllow(input),
  };
};
