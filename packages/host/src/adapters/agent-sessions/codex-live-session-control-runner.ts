import type { AgentSessionControlSummary } from "@openducktor/contracts";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import { commitTitleUpdate } from "../../application/agent-sessions/agent-session-title-update";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

export const createCodexControlRunner = ({
  runtimeId,
  refreshProjection,
}: {
  runtimeId: string;
  refreshProjection: () => Effect.Effect<void, HostError>;
}) => ({
  runSummary: (
    operation: string,
    run: () => Promise<AgentSessionSummary>,
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((summary) =>
        refreshCodexSummary(summary, operation, runtimeId, refreshProjection),
      ),
      Effect.flatMap((summary) => toAgentSessionControlSummary(summary, operation)),
    ),
  runTitleUpdate: (
    operation: string,
    run: () => Promise<AgentSessionTitleUpdateResult>,
  ): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((result) =>
        commitTitleUpdate(result, (summary) =>
          refreshCodexSummary(summary, operation, runtimeId, refreshProjection),
        ),
      ),
    ),
});

const refreshCodexSummary = (
  summary: AgentSessionSummary,
  operation: string,
  runtimeId: string,
  refreshProjection: () => Effect.Effect<void, HostError>,
): Effect.Effect<AgentSessionSummary, HostError> =>
  summary.runtimeKind === "codex"
    ? refreshProjection().pipe(Effect.as(summary))
    : Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Codex control '${operation}' returned runtime kind '${summary.runtimeKind}'.`,
          details: { runtimeId },
        }),
      );
