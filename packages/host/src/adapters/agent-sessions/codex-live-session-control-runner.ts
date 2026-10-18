import type {
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionAuthorizedRoot,
} from "@openducktor/contracts";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import {
  toAgentSessionControlSummary,
  toStartedSessionRoot,
} from "../../application/agent-sessions/agent-session-control-summary";
import { commitTitleUpdate } from "../../application/agent-sessions/agent-session-title-update";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

export const createCodexControlRunner = ({
  runtimeId,
  refreshProjection,
  reportProjectionFailure,
  controller,
}: {
  runtimeId: string;
  controller: Pick<CodexSessionController, "listLiveSessionSnapshots">;
  refreshProjection: (admittedRoot?: AgentSessionAuthorizedRoot) => Effect.Effect<void, HostError>;
  reportProjectionFailure: (
    ref: AgentSessionLiveRef,
    failure: HostError,
  ) => Effect.Effect<void, HostError>;
}) => ({
  runSummary: (
    operation: string,
    run: () => Promise<AgentSessionSummary>,
    creation?: Pick<AgentSessionAuthorizedRoot, "repoPath" | "sessionScope">,
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((summary) =>
        refreshCodexSummary(summary, operation, runtimeId, refreshProjection, creation),
      ),
      Effect.flatMap((summary) => {
        const model = controller
          .listLiveSessionSnapshots(runtimeId)
          .find(
            (snapshot) =>
              snapshot.ref.externalSessionId === summary.externalSessionId &&
              snapshot.ref.workingDirectory === summary.workingDirectory,
          )?.model;
        return toAgentSessionControlSummary(model ? { ...summary, model } : summary, operation);
      }),
    ),
  runTitleUpdate: (
    operation: string,
    ref: AgentSessionLiveRef,
    run: () => Promise<AgentSessionTitleUpdateResult>,
  ): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => toHostOperationError(cause, operation, { runtimeId }),
    }).pipe(
      Effect.flatMap((result) =>
        commitTitleUpdate(
          result,
          (summary) => refreshCodexSummary(summary, operation, runtimeId, refreshProjection),
          (failure) => reportProjectionFailure(ref, failure),
        ),
      ),
    ),
});

const refreshCodexSummary = (
  summary: AgentSessionSummary,
  operation: string,
  runtimeId: string,
  refreshProjection: (admittedRoot?: AgentSessionAuthorizedRoot) => Effect.Effect<void, HostError>,
  creation?: Pick<AgentSessionAuthorizedRoot, "repoPath" | "sessionScope">,
): Effect.Effect<AgentSessionSummary, HostError> =>
  summary.runtimeKind === "codex"
    ? refreshProjection(creation ? toStartedSessionRoot(creation, summary) : undefined).pipe(
        Effect.as(summary),
      )
    : Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Codex control '${operation}' returned runtime kind '${summary.runtimeKind}'.`,
          details: { runtimeId },
        }),
      );
