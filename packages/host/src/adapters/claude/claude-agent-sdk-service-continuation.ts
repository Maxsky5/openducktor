import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { ContinueInterruptedAgentTurnInput, ResumeAgentSessionInput } from "@openducktor/core";
import { interruptedTurnResumeError } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { loadClaudeHistory } from "./claude-agent-sdk-catalog";
import { assertClaudeInterruptedTurnResumeCompatible } from "./claude-continuation-compatibility";
import {
  assertClaudeContinuationEligible,
  assertClaudePersistedContinuationEligible,
} from "./claude-agent-sdk-continuation";
import { resolveClaudeExecutable } from "./claude-agent-sdk-runtime";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type { ClaudeSession, CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";

/** Rejects an interrupted-turn resume that the registered live session cannot start. */
export const checkLiveClaudeContinuationEligibility = (
  session: ClaudeSession,
  input: ResumeAgentSessionInput,
) =>
  fromPromise("claudeRuntime.continueInterruptedTurn", async () => {
    assertClaudeSessionRef(session, input, "continue interrupted turn");
    assertClaudeContinuationEligible(session, input.externalSessionId);
  });

/**
 * Rejects an interrupted-turn resume after a restart, when no live session entry exists.
 * The check reads the persisted transcript because the CLI classifier is not available yet.
 */
export const checkPersistedClaudeContinuationEligibility = (
  input: ResumeAgentSessionInput,
  now: () => string,
) =>
  fromPromise("claudeRuntime.continueInterruptedTurn", () => loadClaudeHistory(input, now)).pipe(
    Effect.catchAll((cause) =>
      Effect.fail(
        toHostOperationError(
          interruptedTurnResumeError({
            reason: "probe_failed",
            message: `Cannot read the persisted Claude transcript for session '${input.externalSessionId}': ${cause.message}`,
            cause,
          }),
          "claudeRuntime.continueInterruptedTurn",
        ),
      ),
    ),
    Effect.flatMap((history) =>
      fromPromise("claudeRuntime.continueInterruptedTurn", async () => {
        assertClaudePersistedContinuationEligible(history, input.externalSessionId);
      }),
    ),
  );

/**
 * Binds the interrupted-turn continuation to the executable the runtime will run.
 * The executable must report the minimum version that owns the continuation contract.
 */
export const assertClaudeContinuationExecutableCompatible = (
  serviceInput: CreateClaudeAgentSdkServiceInput,
  input: ContinueInterruptedAgentTurnInput,
) => {
  const operation = "claudeRuntime.continueInterruptedTurn";
  const sessionRef = {
    repoPath: input.repoPath,
    runtimeKind: input.runtimeKind,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
  } satisfies AgentSessionLiveRef;
  return resolveClaudeExecutable(serviceInput, operation).pipe(
    Effect.mapError(
      (cause) =>
        new AgentSessionResumeError({
          reason: "runtime_unavailable",
          sessionRef,
          operation,
          message: `Cannot resolve the Claude executable for interrupted-turn resume: ${cause.message}`,
          cause,
        }),
    ),
    Effect.flatMap((executablePath) =>
      assertClaudeInterruptedTurnResumeCompatible({
        executablePath,
        sessionRef,
        systemCommands: serviceInput.systemCommands,
      }),
    ),
  );
};
