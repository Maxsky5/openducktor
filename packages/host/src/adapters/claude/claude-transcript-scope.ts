import { realpath } from "node:fs/promises";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import { canonicalPathsEqual } from "../../domain/path-comparison";
import { HostOperationError, errorMessage } from "../../effect/host-errors";
import {
  type GitCommandRunner,
  resolveGitCommonDirectory,
} from "../../infrastructure/git/git-command-runner";
import { isListedWorktreePath, listWorktrees } from "../../infrastructure/git/git-worktree";

export const verifyClaudeTranscriptScope = (input: {
  sessionId: string;
  historicalWorkingDirectory: string;
  workingDirectory: string;
  canonicalWorkingDirectory: string;
  gitRunner?: GitCommandRunner | undefined;
}): Effect.Effect<void, AgentRuntimeQueryError | HostOperationError> => {
  if (
    pathsEqual(input.historicalWorkingDirectory, input.canonicalWorkingDirectory) ||
    pathsEqual(input.historicalWorkingDirectory, input.workingDirectory)
  )
    return Effect.void;
  if (!input.gitRunner) return Effect.fail(mismatch());
  const runner = input.gitRunner;
  return Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => getSessionInfo(input.sessionId, { dir: input.canonicalWorkingDirectory }),
      catch: (cause) =>
        new HostOperationError({
          operation: "claude.transcript.verifyNativeScope",
          message: `Cannot verify access to Claude session '${input.sessionId}': ${errorMessage(cause)}. Check the selected worktree and reload the session.`,
          cause,
        }),
    });
    if (
      !metadata ||
      metadata.sessionId !== input.sessionId ||
      !metadata.cwd ||
      !pathsEqual(metadata.cwd, input.historicalWorkingDirectory)
    )
      return yield* Effect.fail(mismatch());
    const historicalPath = yield* Effect.tryPromise({
      try: () => realpath(input.historicalWorkingDirectory),
      catch: (cause) =>
        new HostOperationError({
          operation: "claude.transcript.verifyWorktreeScope",
          message: `Cannot resolve the saved Claude directory '${input.historicalWorkingDirectory}': ${errorMessage(cause)}. Restore its Git worktree before loading this session.`,
          cause,
        }),
    });
    const shareRepo = yield* Effect.gen(function* () {
      const historicalCommon = yield* resolveGitCommonDirectory(runner, historicalPath);
      const currentCommon = yield* resolveGitCommonDirectory(
        runner,
        input.canonicalWorkingDirectory,
      );
      if (!pathsEqual(historicalCommon, currentCommon)) return false;
      const worktrees = yield* listWorktrees(runner, input.canonicalWorkingDirectory);
      for (const directory of [historicalPath, input.canonicalWorkingDirectory]) {
        if (!(yield* isListedWorktreePath(worktrees, directory))) return false;
      }
      return true;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "claude.transcript.verifyWorktreeScope",
            message: `Cannot verify the Git worktrees for Claude session '${input.sessionId}': ${errorMessage(cause)}. Check the source and selected worktrees, then reload the session.`,
            cause,
          }),
      ),
    );
    if (!shareRepo) return yield* Effect.fail(mismatch());
  });
};

const platform = process.platform === "win32" ? "windows" : "posix";
const pathsEqual = (left: string, right: string): boolean =>
  canonicalPathsEqual(left.normalize("NFC"), right.normalize("NFC"), platform);
const mismatch = () =>
  new AgentRuntimeQueryError(
    "scope_mismatch",
    "The Claude session belongs to another working directory. Select the matching session.",
  );
