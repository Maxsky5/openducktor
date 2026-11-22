import type {
  AgentChatHandoffSendInput,
  AgentChatRef,
  AgentMessageTarget,
  AgentSessionLiveRef,
  AgentSessionScope,
  HandoffContextPrefix,
  HandoffLink,
  WorkflowFailure,
} from "@openducktor/contracts";
import { agentSessionRefsEqual, agentSessionScopesEqual } from "@openducktor/core";
import { Clock, Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import {
  handoffFailure as failure,
  keepAcceptedFailure,
  type HandoffSendResult,
} from "./runtime-handoff-result";

export type PendingHandoff = {
  result: HandoffSendResult;
  staged?: AgentMessageTarget;
  admissionId?: string;
  observedAdmission?: true;
  receipt?: HandoffContextPrefix | null;
  partialHistory?: boolean;
  acceptedAt?: number;
  acceptedFailure?: WorkflowFailure;
};

export type HandoffCommit = (input: {
  chat: AgentChatRef;
  link: HandoffLink;
  model: AgentChatHandoffSendInput["destination"];
  contextPrefix: HandoffContextPrefix | null;
  acceptedAt: number;
}) => Effect.Effect<void, HostError>;

export const releaseStagedHandoff = (
  attempt: PendingHandoff,
  release: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>,
) => {
  if (!attempt.staged) return Effect.void;
  const { repoPath, runtimeKind, workingDirectory, externalSessionId } = attempt.staged;
  return release({ repoPath, runtimeKind, workingDirectory, externalSessionId }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        delete attempt.staged;
      }),
    ),
  );
};

const matchesStagedDestination = (
  staged: AgentMessageTarget | undefined,
  ref: AgentSessionLiveRef,
  scope: AgentSessionScope | undefined,
): boolean =>
  staged !== undefined &&
  agentSessionRefsEqual(staged, ref) &&
  (scope === undefined || agentSessionScopesEqual(staged.sessionScope, scope));

export const hasStagedHandoffDestination = (
  attempts: Iterable<PendingHandoff>,
  ref: AgentMessageTarget,
): boolean => {
  for (const { staged } of attempts) {
    if (matchesStagedDestination(staged, ref, ref.sessionScope)) return true;
  }
  return false;
};

export function findAcceptedHandoffDestination(
  attempts: Iterable<PendingHandoff>,
  ref: AgentSessionLiveRef,
  scope: AgentSessionScope | undefined,
) {
  for (const { staged, result, receipt } of attempts) {
    const link = result.handoff.acceptedLink;
    if (link && matchesStagedDestination(staged, ref, scope))
      return { firstMessageId: link.firstMessageId, receipt };
  }
  return null;
}

export const settleAcceptedHandoff =
  (deps: {
    commit: HandoffCommit;
    publishOwner: (chat: AgentChatRef) => Effect.Effect<void, HostError>;
    publish: (attempt: PendingHandoff) => Effect.Effect<void, HostError>;
    onCommit: (chat: AgentChatRef) => void;
  }) =>
  (attempt: PendingHandoff, firstMessageId: string) =>
    Effect.gen(function* () {
      const { staged, result } = attempt;
      if (!staged)
        return yield* new HostValidationError({
          field: "handoff",
          message: "The accepted destination session is unavailable.",
        });
      const link: HandoffLink = result.handoff.acceptedLink ?? {
        from: result.handoff.expectedActive,
        to: {
          runtimeKind: staged.runtimeKind,
          workingDirectory: staged.workingDirectory,
          externalSessionId: staged.externalSessionId,
        },
        firstMessageId,
        partialHistory: attempt.partialHistory ?? false,
      };
      attempt.acceptedAt ??= yield* Clock.currentTimeMillis;
      attempt.result = {
        ...result,
        pending: true,
        nativeOutcome: "accepted",
        handoff: { ...result.handoff, acceptedLink: link },
      };
      if (attempt.acceptedFailure) attempt.result.failure = attempt.acceptedFailure;
      else delete attempt.result.failure;
      yield* deps.publish(attempt);
      const commit = yield* Effect.result(
        deps.commit({
          chat: result.handoff.chat,
          model: result.handoff.destination,
          link,
          acceptedAt: attempt.acceptedAt,
          contextPrefix: attempt.receipt ?? null,
        }),
      );
      attempt.result.pending = false;
      if (commit._tag === "Failure") {
        attempt.result.failure = failure(
          "save",
          [attempt.acceptedFailure?.message, commit.failure.message].filter(Boolean).join(" "),
          "Check the handoff to save the accepted message without another send.",
        );
      } else {
        attempt.result.handoff.committed = true;
        deps.onCommit(result.handoff.chat);
        const publication = yield* Effect.result(deps.publishOwner(result.handoff.chat));
        if (publication._tag === "Failure")
          attempt.result.failure = keepAcceptedFailure(
            attempt.acceptedFailure,
            failure(
              "publish",
              publication.failure.message,
              "Reopen the chat to see the committed handoff.",
            ),
          );
      }
      yield* deps.publish(attempt);
    });
