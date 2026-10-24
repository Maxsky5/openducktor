import { isAbsolute } from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";
import { findClaudeSessionTranscripts } from "./claude-transcript-reader";

/** Reads native Claude metadata from the Claude folder of the environment that runs Claude. */
export const createClaudeSessionMetadataAdapter = (
  readEnv: () => NodeJS.ProcessEnv,
): ClaudeSessionMetadataPort => ({
  readWorkingDirectory: (externalSessionId) =>
    Effect.gen(function* () {
      const transcripts = yield* Effect.tryPromise({
        try: () => findClaudeSessionTranscripts(readEnv(), externalSessionId),
        catch: (cause) =>
          new HostOperationError({
            operation: "claude.session.metadata.readWorkingDirectory",
            message: `Cannot find the transcript of Claude session '${externalSessionId}': ${errorMessage(cause)}. Check access to the Claude folder, then retry.`,
            cause,
          }),
      });
      // Without a transcript, Claude keeps no history that needs a directory.
      if (transcripts.length === 0) return null;
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
          message: `Claude cannot read the metadata of session '${externalSessionId}'. Turn off worktree removal to archive the chat.`,
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
    }),
});
