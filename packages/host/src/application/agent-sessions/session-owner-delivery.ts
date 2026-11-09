import type { AcceptedAgentInput, AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import type { createSessionOperationOwner } from "./session-operation-owner";

/** Sends the primary input of the current operation and records its acceptance. */
export const deliverWithOwner = <E>(
  owner: Pick<ReturnType<typeof createSessionOperationOwner>, "options" | "accepted">,
  ref: AgentSessionLiveRef,
  send: (guard: {
    assertCurrent: (() => void) | undefined;
    onSent: () => void;
  }) => Effect.Effect<AcceptedAgentInput, E>,
  onSent?: () => void,
) =>
  Effect.gen(function* () {
    const guarded = yield* owner.options();
    const accepted = yield* send({
      assertCurrent: guarded.assertCurrent,
      onSent: () => {
        guarded.onSent();
        onSent?.();
      },
    });
    yield* owner
      .accepted(accepted)
      .pipe(Effect.mapError(messageAcceptedFailure(ref, accepted, "record_message")));
    return accepted;
  });
