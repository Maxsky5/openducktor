import type { AgentSessionControlSummary } from "@openducktor/contracts";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import { commitTitleUpdate } from "../../application/agent-sessions/agent-session-title-update";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

type SummaryOptions = {
  readonly parentExternalSessionId?: string;
  readonly keepActivity?: boolean;
};

export const createClaudeControlRunner = ({
  runControlMutation,
  retainSummary,
}: {
  runControlMutation: <Value>(
    effect: Effect.Effect<Value, HostError>,
  ) => Effect.Effect<Value, HostError>;
  retainSummary: (
    operation: string,
    summary: AgentSessionSummary,
    options: SummaryOptions,
  ) => Effect.Effect<AgentSessionSummary, HostError>;
}) => ({
  runSummary: (
    operation: string,
    run: () => Effect.Effect<AgentSessionSummary, HostError>,
    options: SummaryOptions = {},
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    runControlMutation(
      run().pipe(
        Effect.flatMap((summary) => retainSummary(operation, summary, options)),
        Effect.flatMap((summary) => toAgentSessionControlSummary(summary, operation)),
      ),
    ),
  runTitleUpdate: (
    operation: string,
    run: () => Effect.Effect<AgentSessionTitleUpdateResult, HostError>,
  ): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
    runControlMutation(
      run().pipe(
        Effect.flatMap((result) =>
          commitTitleUpdate(result, (summary) => retainSummary(operation, summary, {})),
        ),
      ),
    ),
});
