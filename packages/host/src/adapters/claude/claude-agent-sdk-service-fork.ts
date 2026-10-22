import type { AgentSessionForkPoint } from "@openducktor/contracts";
import type {
  AgentSessionScope,
  AgentSessionSummary,
  ForkAgentSessionInput,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError, errorMessage } from "../../effect/host-errors";
import type { ClaudeAgentSdkServiceError, ClaudeSessionStore } from "./claude-agent-sdk-types";
import {
  claudeLiveHistoryContext,
  loadClaudeHistorySnapshot,
} from "./claude-agent-sdk-history-loader";
import { resolveClaudeQuerySession } from "./claude-agent-sdk-query-session";
import type { ClaudeTranscriptReadOwner } from "./claude-transcript-read-owner";
import { discardClaudeReplyFork, forkClaudeReplySession } from "./claude-agent-sdk-reply-fork";
import {
  forkedClaudeReplySessionLaunch,
  type ClaudeSessionLaunchInput,
} from "./claude-agent-sdk-session-policy";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { fromPromise, fromSync, toClaudeServiceError } from "./claude-agent-sdk-utils";

export const forkClaudeReply = (options: {
  input: ForkAgentSessionInput & { forkPoint: AgentSessionForkPoint };
  scope: AgentSessionScope;
  sessionStore: ClaudeSessionStore;
  historyReader: ClaudeTranscriptReadOwner;
  now: () => string;
  attach: (
    launch: ClaudeSessionLaunchInput,
  ) => Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
}): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError> =>
  Effect.gen(function* () {
    const { input } = options;
    if (
      input.runtimeHistoryAnchor ||
      parseClaudeTranscriptTarget(input.parentExternalSessionId).subpath
    ) {
      return yield* new HostValidationError({
        field: "forkPoint",
        message:
          "Select a completed reply in a root Claude session without a legacy history anchor.",
      });
    }
    const source = {
      ...input,
      workingDirectory: input.sourceWorkingDirectory ?? input.workingDirectory,
      externalSessionId: input.parentExternalSessionId,
    };
    const existing = options.sessionStore.get(source.externalSessionId);
    if (existing) {
      yield* fromSync("claudeRuntime.forkSession", () =>
        assertClaudeSessionRef(existing, source, "fork"),
      );
    }
    const loadHistorySnapshot = (source: LoadAgentSessionHistoryInput) => {
      const { session } = resolveClaudeQuerySession(options.sessionStore, source);
      const liveContext = session
        ? claudeLiveHistoryContext(session, source.externalSessionId)
        : undefined;
      return loadClaudeHistorySnapshot(source, options.now, liveContext, {
        reader: options.historyReader,
      }).pipe(
        Effect.mapError((cause) => toClaudeServiceError("claudeRuntime.loadSessionHistory", cause)),
      );
    };
    const { history, messages } = yield* loadHistorySnapshot(source);
    const childId = yield* fromPromise("claudeRuntime.forkSession", () =>
      forkClaudeReplySession({
        source,
        forkPoint: input.forkPoint,
        history,
        messages,
        completedReplyChainIds: existing?.completedReplyChainIds,
      }),
    );
    return yield* options
      .attach(forkedClaudeReplySessionLaunch(options.scope, childId, source.workingDirectory))
      .pipe(
        Effect.tap(() =>
          loadHistorySnapshot({
            ...source,
            workingDirectory: input.workingDirectory,
            externalSessionId: childId,
          }),
        ),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            const child = options.sessionStore.getForCleanup(childId);
            const stopped = child ? yield* Effect.result(options.sessionStore.settle(child)) : null;
            const deleted = yield* Effect.result(
              fromPromise("claudeRuntime.forkSession.cleanup", () =>
                discardClaudeReplyFork(childId, source.workingDirectory, cause),
              ),
            );
            const cleanupErrors = [
              ...(stopped?._tag === "Failure" ? [stopped.failure] : []),
              ...(deleted._tag === "Failure" ? [deleted.failure] : []),
            ];
            if (cleanupErrors.length > 0)
              return yield* new HostOperationError({
                operation: "claudeRuntime.forkSession.cleanup",
                message: `${errorMessage(cause)} Claude fork '${childId}' cleanup also failed: ${cleanupErrors.map(errorMessage).join(" ")}. Inspect that unused native session before retrying.`,
                cause: new AggregateError(
                  [cause, ...cleanupErrors],
                  "Claude fork and cleanup failed.",
                ),
              });
            return yield* Effect.fail(cause);
          }),
        ),
      );
  });
