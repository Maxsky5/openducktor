import { isAbsolute } from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";

export const claudeSessionMetadataAdapter: ClaudeSessionMetadataPort = {
  readWorkingDirectory: (externalSessionId) =>
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
          message: `Metadata for Claude session '${externalSessionId}' is missing or unreadable. Turn off worktree removal to archive the chat.`,
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
};
