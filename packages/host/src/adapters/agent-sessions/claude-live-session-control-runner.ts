import type { AgentSessionControlSummary } from "@openducktor/contracts";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import { commitTitleUpdate } from "../../application/agent-sessions/agent-session-title-update";
import type { HostError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionTitleUpdateOutcome,
} from "../../ports/agent-session-live-adapter-port";

type SummaryOptions = {
  readonly parentExternalSessionId?: string;
  readonly keepActivity?: boolean;
};

type CommitMutation = <Value>(
  operation: string,
  mutation: () => AgentSessionLiveAdapterMutation<Value>,
) => Effect.Effect<Value, HostError>;

export const createClaudeControlRunner = ({
  runControlMutation,
  retainSummary,
  reportProjectionFailure,
}: {
  runControlMutation: <Value>(
    effect: Effect.Effect<Value, HostError>,
  ) => Effect.Effect<Value, HostError>;
  retainSummary: (
    operation: string,
    repoPath: string,
    summary: AgentSessionSummary,
    options: SummaryOptions,
  ) => Effect.Effect<AgentSessionSummary, HostError>;
  reportProjectionFailure: (
    operation: string,
    repoPath: string,
    failure: HostError,
  ) => Effect.Effect<void, HostError>;
}) => ({
  /** `repoPath` is the repository of the request. Summaries carry no repository. */
  runSummary: (
    operation: string,
    repoPath: string,
    run: () => Effect.Effect<AgentSessionSummary, HostError>,
    options: SummaryOptions = {},
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    runControlMutation(
      run().pipe(
        Effect.flatMap((summary) => retainSummary(operation, repoPath, summary, options)),
        Effect.flatMap((summary) => toAgentSessionControlSummary(summary, operation)),
      ),
    ),
  runTitleUpdate: (
    operation: string,
    repoPath: string,
    run: () => Effect.Effect<AgentSessionTitleUpdateResult, HostError>,
  ): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
    runControlMutation(
      run().pipe(
        Effect.flatMap((result) =>
          commitTitleUpdate(
            result,
            (summary) => retainSummary(operation, repoPath, summary, { keepActivity: true }),
            (failure) => reportProjectionFailure(operation, repoPath, failure),
          ),
        ),
      ),
    ),
});

export const createClaudeProjectionFailureReporter =
  (dependencies: { commit: CommitMutation }) =>
  (operation: string, repoPath: string, failure: HostError): Effect.Effect<void, HostError> =>
    dependencies.commit(`${operation}.report-projection-failure`, () => ({
      value: undefined,
      changes: [
        {
          type: "fault",
          repoPath,
          operation,
          message: failure.message,
        },
      ],
    }));
