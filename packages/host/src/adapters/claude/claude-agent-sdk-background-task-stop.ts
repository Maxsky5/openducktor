import type { AgentSessionBackgroundTaskStopInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkServiceError } from "../../application/runtimes/claude-agent-sdk-service";
import { findClaudeBackgroundTaskRun } from "./claude-agent-sdk-background-task-list";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";
import { fromSync } from "./claude-agent-sdk-utils";

const operation = "claudeRuntime.stopBackgroundTask";

/**
 * Stops the background task run that `input.taskId` names in the session tree of the ref. A run
 * that does not run in that tree, or that ended, needs no stop. A failed stop of a task that ended meanwhile is a success.
 */
export const stopClaudeBackgroundTask = (
  sessionStore: Pick<ClaudeSessionStore, "get">,
  input: AgentSessionBackgroundTaskStopInput,
): Effect.Effect<void, ClaudeAgentSdkServiceError> =>
  Effect.gen(function* () {
    const session = sessionStore.get(
      parseClaudeTranscriptTarget(input.externalSessionId).sessionId,
    );
    if (!session) return;
    yield* fromSync(operation, () =>
      assertClaudeSessionRef(
        session,
        { ...input, externalSessionId: session.externalSessionId },
        "stop a background task of",
      ),
    );
    const found = findClaudeBackgroundTaskRun(session, input.externalSessionId, input.taskId);
    if (!found) return;
    const { nativeTaskId, run } = found;
    run.stopRequested = true;
    yield* Effect.tryPromise({
      try: () => session.query.stopTask(nativeTaskId),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) => {
        if (run.ended) return Effect.void;
        delete run.stopRequested;
        return Effect.fail(
          new HostOperationError({
            operation,
            message: `Claude could not stop background task '${nativeTaskId}': ${errorMessage(cause)}`,
            cause,
            details: { externalSessionId: input.externalSessionId, taskId: input.taskId },
          }),
        );
      }),
    );
  }).pipe(Effect.withSpan(operation));
