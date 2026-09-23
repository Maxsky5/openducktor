import type { AgentSessionControlSummary } from "@openducktor/contracts";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

const refreshCodexSummary = <Result extends { summary: AgentSessionSummary }>(
  result: Result,
  operation: string,
  runtimeId: string,
  refreshProjection: () => Effect.Effect<void, HostError>,
): Effect.Effect<Result, HostError> =>
  result.summary.runtimeKind === "codex"
    ? refreshProjection().pipe(Effect.as(result))
    : Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Codex control '${operation}' returned runtime kind '${result.summary.runtimeKind}'.`,
          details: { runtimeId },
        }),
      );

export const createCodexControlSummaryRunner = ({
  runtimeId,
  refreshProjection,
}: {
  runtimeId: string;
  refreshProjection: () => Effect.Effect<void, HostError>;
}) => {
  return (
    operation: string,
    run: () => Promise<AgentSessionSummary>,
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((summary) =>
        refreshCodexSummary({ summary }, operation, runtimeId, refreshProjection),
      ),
      Effect.flatMap(({ summary }) => toAgentSessionControlSummary(summary, operation)),
    );
};

export const createCodexTitleUpdateRunner = ({
  runtimeId,
  refreshProjection,
}: {
  runtimeId: string;
  refreshProjection: () => Effect.Effect<void, HostError>;
}) => {
  return (
    operation: string,
    run: () => Promise<AgentSessionTitleUpdateResult>,
  ): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((result): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
        result.status === "not_attached"
          ? Effect.succeed({ status: "not_attached" as const })
          : refreshCodexSummary(result, operation, runtimeId, refreshProjection).pipe(
              Effect.as({ status: "renamed" as const }),
            ),
      ),
    );
};
