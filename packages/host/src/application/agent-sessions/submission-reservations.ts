import type { AgentMessageSubmitInput, AgentMessageSubmitResult } from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit } from "effect";
import { errorMessage, HostOperationError, type HostError } from "../../effect/host-errors";
import { SessionOperationError } from "../../ports/session-operation-error";
import { WorkflowIntentRejectedError } from "../../ports/workflow-intent-rejected-error";
import { actionError } from "./agent-message-queue-model";

const compactResult = (
  input: AgentMessageSubmitInput,
  result: AgentMessageSubmitResult,
): AgentMessageSubmitResult => {
  if (result.kind === "acknowledged") return result;
  const receipt: AgentMessageSubmitResult = {
    kind: "acknowledged",
    submissionId: input.submissionId,
    outcome:
      result.kind === "queued" &&
      result.queue.entries.some(
        (entry) =>
          entry.submissionId === input.submissionId && entry.state === "acceptance_unknown",
      )
        ? "uncertain"
        : result.kind,
  };
  if (result.kind === "accepted") {
    const { sessionScope: _scope, parts: _parts, mode: _mode, submissionId, ...ref } = input;
    receipt.acknowledgement =
      result.acceptedMessage.type === "user_message"
        ? { kind: "message", ref, submissionId, messageId: result.acceptedMessage.messageId }
        : { kind: "command", ref, submissionId, acceptedCommand: result.acceptedMessage };
  }
  return receipt;
};

const compactFailure = (cause: Cause.Cause<HostError>): HostError => {
  const failure = Cause.squash(cause);
  const message = errorMessage(failure);
  if (failure instanceof SessionOperationError) {
    const { acceptedInput: _input, ...observation } = failure.observation;
    return new SessionOperationError(structuredClone(observation), new Error(message));
  }
  if (failure instanceof WorkflowIntentRejectedError)
    return new WorkflowIntentRejectedError(new Error(message));
  return new HostOperationError({ operation: "submission.previous-result", message });
};

/** A submission identity admits one intent for the lifetime of this host. */
export const createSubmissionReservations = (
  fingerprint: (input: AgentMessageSubmitInput) => string,
) => {
  const submissions = new Map<
    string,
    { fingerprint: string; result: Effect.Effect<AgentMessageSubmitResult, HostError> }
  >();
  return (
    input: AgentMessageSubmitInput,
    work: Effect.Effect<AgentMessageSubmitResult, HostError>,
  ) =>
    Effect.suspend(() => {
      const identity = fingerprint(input);
      const prior = submissions.get(input.submissionId);
      if (prior)
        return prior.fingerprint === identity
          ? prior.result
          : Effect.fail(
              actionError(
                "This submission ID already belongs to a different target or message. Use a new submission for a deliberate new message.",
              ),
            );
      const done = Deferred.makeUnsafe<AgentMessageSubmitResult, HostError>();
      const reservation = { fingerprint: identity, result: Deferred.await(done) };
      submissions.set(input.submissionId, reservation);
      return work.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const settled =
              exit._tag === "Success"
                ? Exit.succeed(compactResult(input, exit.value))
                : Exit.fail(compactFailure(exit.cause));
            reservation.result = settled;
            yield* Deferred.done(done, exit);
          }),
        ),
      );
    });
};
