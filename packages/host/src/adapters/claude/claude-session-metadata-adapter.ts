import { isAbsolute } from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type {
  ClaudeSessionMetadataPort,
  ClaudeWorkingDirectoryRead,
} from "../../ports/claude-session-metadata-port";
import { listClaudeSessionTranscriptIds } from "./claude-transcript-reader";

/** The working directory of a session that has a transcript. */
const readSessionWorkingDirectory = (
  externalSessionId: string,
): Effect.Effect<string, HostOperationError> =>
  Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => getSessionInfo(externalSessionId),
      catch: (cause) =>
        new HostOperationError({
          operation: "claude.session.metadata.readWorkingDirectory",
          message: `Cannot read metadata for Claude session '${externalSessionId}': ${errorMessage(cause)}. Check access to the native Claude session, then retry.`,
          cause,
        }),
    });
    if (!metadata) {
      return yield* new HostOperationError({
        operation: "claude.session.metadata.readWorkingDirectory",
        message: `Claude cannot read the metadata of session '${externalSessionId}'. Open the session in Claude Code to check it, then retry.`,
      });
    }
    if (metadata.sessionId !== externalSessionId) {
      return yield* new HostOperationError({
        operation: "claude.session.metadata.readWorkingDirectory",
        message: `Claude returned metadata for another session instead of '${externalSessionId}'. Update Claude Code and reload the saved session, then retry.`,
      });
    }
    if (!metadata.cwd?.trim() || !isAbsolute(metadata.cwd)) {
      return yield* new HostOperationError({
        operation: "claude.session.metadata.readWorkingDirectory",
        message: `Claude session '${externalSessionId}' has no absolute working directory in its native metadata. Open the session in Claude Code and check its saved directory, then retry.`,
      });
    }
    return metadata.cwd;
  });

const METADATA_READ_CONCURRENCY = 8;

/** Reads native Claude metadata from the Claude folder of the environment that runs Claude. */
export const createClaudeSessionMetadataAdapter = (
  readEnv: () => NodeJS.ProcessEnv,
): ClaudeSessionMetadataPort => ({
  readWorkingDirectories: (externalSessionIds) =>
    Effect.gen(function* () {
      if (externalSessionIds.length === 0) return new Map<string, ClaudeWorkingDirectoryRead>();
      const transcripts = yield* Effect.tryPromise({
        try: () => listClaudeSessionTranscriptIds(readEnv()),
        catch: (cause) =>
          new HostOperationError({
            operation: "claude.session.metadata.readWorkingDirectory",
            message: `Cannot list the Claude transcripts: ${errorMessage(cause)}. Check access to the Claude folder, then retry.`,
            cause,
          }),
      });
      const entries = yield* Effect.forEach(
        new Set(externalSessionIds),
        (externalSessionId) =>
          Effect.gen(function* () {
            let entry: ClaudeWorkingDirectoryRead = { kind: "read", directory: null };
            // Without a transcript, Claude keeps no history that needs a directory.
            if (transcripts.has(externalSessionId)) {
              const read = yield* Effect.result(readSessionWorkingDirectory(externalSessionId));
              entry =
                read._tag === "Success"
                  ? { kind: "read", directory: read.success }
                  : { kind: "failed", error: read.failure };
            }
            return [externalSessionId, entry] as const;
          }),
        { concurrency: METADATA_READ_CONCURRENCY },
      );
      return new Map(entries);
    }),
});
