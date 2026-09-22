import type { AgentSessionControlSummary } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";

export type CodexControlSummaryRunner = (
  operation: string,
  run: () => Promise<AgentSessionSummary>,
) => Effect.Effect<AgentSessionControlSummary, HostError>;

export const createCodexControlSummaryRunner = ({
  runtimeId,
  refreshProjection,
}: {
  runtimeId: string;
  refreshProjection: () => Effect.Effect<void, HostError>;
}): CodexControlSummaryRunner => {
  return (operation, run) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((summary) =>
        summary.runtimeKind === "codex"
          ? refreshProjection().pipe(Effect.as(summary))
          : Effect.fail(
              new HostValidationError({
                field: "runtimeKind",
                message: `Codex control '${operation}' returned runtime kind '${summary.runtimeKind}'.`,
                details: { runtimeId },
              }),
            ),
      ),
      Effect.flatMap((summary) => toAgentSessionControlSummary(summary, operation)),
    );
};
