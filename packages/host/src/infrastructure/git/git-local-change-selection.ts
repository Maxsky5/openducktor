import path from "node:path";
import type { GitFileDiff, GitChangeGroup, GitChangeSelectionResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  GitChangeInput,
  GitLocalChangeGroupData,
  GitLocalChangesData,
  GitPortError,
} from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandRunner,
  pathExists,
  runGit,
  runGitAllowFailure,
  runGitWithStdinAllowFailure,
} from "./git-command-runner";
import { invalid, literal, RAW_DIFF_OPTIONS, STALE_SELECTION_MESSAGE } from "./git-local-changes";
import { combinePatchHunk, hunksMatch, parsePatchHunks } from "./git-patch";

const runGitStep = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
  operation: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, args);
    if (!result.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation,
          message: `git ${args[0]} failed: ${combineOutput(result.stdout, result.stderr)}`,
        }),
      );
    }
  });

type ApplyMode = { cached: boolean; reverse: boolean };

const applyPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  patch: string,
  mode: ApplyMode,
  check: boolean,
) => {
  // A user `apply.whitespace=fix` setting would rewrite the selected lines.
  const args = ["apply", "--whitespace=nowarn"];
  if (mode.cached) args.push("--cached");
  if (mode.reverse) args.push("--reverse");
  if (check) args.push("--check");
  args.push("-");
  return runGitWithStdinAllowFailure(runner, workingDirectory, args, patch);
};

/** Checks the patch first, so a rejected patch changes nothing. */
const checkAndApplyPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  patch: string,
  mode: ApplyMode,
  filePath: string,
) =>
  Effect.gen(function* () {
    const checked = yield* applyPatch(runner, workingDirectory, patch, mode, true);
    if (!checked.ok) {
      return yield* Effect.fail(
        invalid(
          `Git cannot apply the selected change to ${filePath}: ${combineOutput(checked.stdout, checked.stderr)} Refresh and review the changes.`,
          "selection",
        ),
      );
    }
    const applied = yield* applyPatch(runner, workingDirectory, patch, mode, false);
    if (!applied.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.apply",
          message: `git apply failed for ${filePath}: ${combineOutput(applied.stdout, applied.stderr)}`,
        }),
      );
    }
  });

/**
 * Removes a staged edit from the index and the working file.
 * Both checks run first, so an overlap with unstaged edits changes nothing.
 */
const discardStagedPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  patch: string,
  filePath: string,
) =>
  Effect.gen(function* () {
    const index = { cached: true, reverse: true };
    const worktree = { cached: false, reverse: true };
    const indexCheck = yield* applyPatch(runner, workingDirectory, patch, index, true);
    if (!indexCheck.ok) {
      return yield* Effect.fail(invalid(STALE_SELECTION_MESSAGE, "snapshots"));
    }
    const worktreeCheck = yield* applyPatch(runner, workingDirectory, patch, worktree, true);
    if (!worktreeCheck.ok) {
      return yield* Effect.fail(
        invalid(
          `The staged edit in ${filePath} overlaps unstaged edits, so it cannot be discarded alone. Unstage it, or review the unstaged edits first.`,
          "selection",
        ),
      );
    }
    const indexApplied = yield* applyPatch(runner, workingDirectory, patch, index, false);
    if (!indexApplied.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.apply.cached",
          message: `git apply failed for ${filePath}: ${combineOutput(indexApplied.stdout, indexApplied.stderr)}`,
        }),
      );
    }
    const worktreeApplied = yield* applyPatch(runner, workingDirectory, patch, worktree, false);
    if (!worktreeApplied.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.apply.worktree",
          message: `Git removed the staged edit in ${filePath} from the index, but could not update the working file: ${combineOutput(worktreeApplied.stdout, worktreeApplied.stderr)} Refresh to review the current state.`,
        }),
      );
    }
  });

/**
 * The reason that a file has no independent chunk actions, or null when it has them.
 * The panel shows the same rules in `git-file-row-actions.ts`.
 */
const chunkActionUnavailableReason = (fileDiff: GitFileDiff): string | null => {
  if (fileDiff.type === "submodule") return "Submodule changes have no text chunks.";
  if (fileDiff.type === "added") return "New files change only as a whole file.";
  if (fileDiff.type === "deleted") return "Deleted files change only as a whole file.";
  if (fileDiff.type === "renamed") return "Renamed files change only as a whole file.";
  return null;
};

/**
 * Reads the patch that a write applies. Display diffs lose carriage returns, and the runner reads
 * UTF-8 text, so a write reads its own patch and refuses bytes that the text round trip changes.
 */
const readWritePatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  group: GitChangeGroup,
  paths: string[],
  options: { binary: boolean; wholeFileHint: string },
) =>
  Effect.gen(function* () {
    const args = ["diff", ...RAW_DIFF_OPTIONS];
    if (group === "staged") args.push("--cached");
    if (options.binary) args.push("--binary");
    const patch = yield* runGit(runner, workingDirectory, [...args, "--", ...paths.map(literal)]);
    if (!patch.trim()) return yield* Effect.fail(invalid(STALE_SELECTION_MESSAGE, "selection"));
    // Invalid UTF-8 decodes to U+FFFD. Writing that text back would replace the original bytes.
    if (patch.includes("\uFFFD")) {
      return yield* Effect.fail(
        invalid(
          `${paths[0]} holds bytes that are not UTF-8 text, so Git cannot change this selection without changing those bytes. ${options.wholeFileHint}`,
          "selection",
        ),
      );
    }
    return patch;
  });

const parseHunks = (patch: string) =>
  Effect.try({
    try: () => parsePatchHunks(patch),
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : invalid(cause instanceof Error ? cause.message : String(cause), "selection"),
  });

const selectHunkPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  groupName: GitChangeGroup,
  group: GitLocalChangeGroupData,
  filePath: string,
  hunkIndex: number,
) =>
  Effect.gen(function* () {
    const fileDiff = group.fileDiffs.find((diff) => diff.file === filePath);
    if (!fileDiff) return yield* Effect.fail(invalid(STALE_SELECTION_MESSAGE, "selection"));
    const unavailable = chunkActionUnavailableReason(fileDiff);
    if (unavailable) {
      return yield* Effect.fail(invalid(`${unavailable} Use the file action.`, "selection"));
    }
    const raw = yield* readWritePatch(runner, workingDirectory, groupName, [filePath], {
      binary: false,
      wholeFileHint: "Use the file action.",
    });
    const parsed = yield* parseHunks(raw);
    // The snapshot check proved the reviewed diff. A file can change after that check, so the
    // patch to apply must hold the same chunks, with the same ranges and the same lines.
    const reviewed = yield* parseHunks(fileDiff.diff);
    if (
      reviewed.hunks.length !== parsed.hunks.length ||
      reviewed.hunks.some((hunk, index) => {
        const applied = parsed.hunks[index];
        return !applied || !hunksMatch(hunk, applied);
      })
    ) {
      return yield* Effect.fail(invalid(STALE_SELECTION_MESSAGE, "selection"));
    }
    if (parsed.renamePaths) {
      return yield* Effect.fail(
        invalid("Renamed files change only as a whole file. Use the file action.", "selection"),
      );
    }
    const hunk = parsed.hunks[hunkIndex];
    if (!hunk) {
      return yield* Effect.fail(
        invalid(
          parsed.hunks.length === 0
            ? "This change has no text chunks. Use the file action."
            : STALE_SELECTION_MESSAGE,
          "selection",
        ),
      );
    }
    return combinePatchHunk(parsed.header, hunk);
  });

/**
 * Git applies a submodule change to the index only, and a plain restore does not change the
 * submodule checkout. Discard would report a change that did not happen, so it stops first.
 */
const requireDiscardable = (group: GitLocalChangeGroupData, filePath: string) =>
  group.fileDiffs.some((diff) => diff.file === filePath && diff.type === "submodule")
    ? Effect.fail(
        invalid(
          `${filePath} is a submodule. Discard cannot change the commit that the submodule has checked out. Run \`git submodule update -- ${filePath}\` to check out the recorded commit, or unstage the change.`,
          "selection",
        ),
      )
    : Effect.void;

const requireGroupEntry = (group: GitLocalChangeGroupData, filePath: string) =>
  Effect.gen(function* () {
    const status = group.fileStatuses.find((entry) => entry.path === filePath);
    const diff = group.fileDiffs.find((entry) => entry.file === filePath);
    if (!status && !diff) {
      return yield* Effect.fail(invalid(STALE_SELECTION_MESSAGE, "selection"));
    }
    return status;
  });

const stagedPaths = (group: GitLocalChangeGroupData, filePath: string): string[] => {
  const status = group.fileStatuses.find((entry) => entry.path === filePath);
  return status?.originalPath ? [filePath, status.originalPath] : [filePath];
};

const discardUntrackedFile = (runner: GitCommandRunner, workingDirectory: string, file: string) =>
  Effect.gen(function* () {
    yield* runGitStep(
      runner,
      workingDirectory,
      ["clean", "-f", "-q", "--", literal(file)],
      "git.clean",
    );
    // Git skips a nested repository without reporting an error.
    if (yield* pathExists(path.join(workingDirectory, file))) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.clean",
          message: `Git did not delete ${file}. Delete it outside OpenDucktor, then refresh.`,
        }),
      );
    }
  });

const changeFile = (
  runner: GitCommandRunner,
  workingDirectory: string,
  changes: GitLocalChangesData,
  input: GitChangeInput & { selection: { kind: "file"; filePath: string } },
): Effect.Effect<string[], GitPortError> =>
  Effect.gen(function* () {
    const filePath = input.selection.filePath;
    const group = changes[input.group];
    const status = yield* requireGroupEntry(group, filePath);
    if (input.action === "stage") {
      yield* runGitStep(
        runner,
        workingDirectory,
        ["add", "-A", "--", literal(filePath)],
        "git.add",
      );
      return [filePath];
    }
    if (input.action === "unstage") {
      const paths = stagedPaths(group, filePath);
      yield* runGitStep(
        runner,
        workingDirectory,
        ["reset", "-q", "--", ...paths.map(literal)],
        "git.reset",
      );
      return paths;
    }
    yield* requireDiscardable(group, filePath);
    if (input.group === "unstaged") {
      if (status?.status === "untracked") {
        yield* discardUntrackedFile(runner, workingDirectory, filePath);
      } else {
        yield* runGitStep(
          runner,
          workingDirectory,
          ["restore", "--worktree", "--", literal(filePath)],
          "git.restore",
        );
      }
      return [filePath];
    }
    const paths = stagedPaths(group, filePath);
    const patch = yield* readWritePatch(runner, workingDirectory, "staged", paths, {
      binary: true,
      wholeFileHint: "Unstage the file, then review and discard it in Unstaged.",
    });
    yield* discardStagedPatch(runner, workingDirectory, patch, filePath);
    return paths;
  });

const changeHunk = (
  runner: GitCommandRunner,
  workingDirectory: string,
  changes: GitLocalChangesData,
  input: GitChangeInput & { selection: { kind: "hunk"; filePath: string; hunkIndex: number } },
): Effect.Effect<string[], GitPortError> =>
  Effect.gen(function* () {
    const { filePath, hunkIndex } = input.selection;
    const patch = yield* selectHunkPatch(
      runner,
      workingDirectory,
      input.group,
      changes[input.group],
      filePath,
      hunkIndex,
    );
    if (input.action === "discard" && input.group === "staged") {
      yield* discardStagedPatch(runner, workingDirectory, patch, filePath);
      return [filePath];
    }
    const mode = {
      stage: { cached: true, reverse: false },
      unstage: { cached: true, reverse: true },
      discard: { cached: false, reverse: true },
    } satisfies Record<GitChangeInput["action"], ApplyMode>;
    yield* checkAndApplyPatch(runner, workingDirectory, patch, mode[input.action], filePath);
    return [filePath];
  });

const changeAll = (
  runner: GitCommandRunner,
  workingDirectory: string,
  changes: GitLocalChangesData,
  input: GitChangeInput,
): Effect.Effect<string[], GitPortError> =>
  Effect.gen(function* () {
    if (changes.conflicted.fileStatuses.length > 0) {
      return yield* Effect.fail(
        invalid("Resolve the conflicted files before you change the whole group.", "selection"),
      );
    }
    const group = changes[input.group];
    const paths = group.fileStatuses.flatMap((status) =>
      status.originalPath ? [status.path, status.originalPath] : [status.path],
    );
    if (paths.length === 0) {
      return yield* Effect.fail(invalid(`There are no ${input.group} changes.`, "selection"));
    }
    const args =
      input.action === "stage" ? ["add", "-A", "--", ":(top)"] : ["reset", "-q", "--", ":(top)"];
    yield* runGitStep(runner, workingDirectory, args, `git.${args[0]}`);
    return paths;
  });

export const changeLocalSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  changes: GitLocalChangesData,
  input: GitChangeInput,
): Effect.Effect<Pick<GitChangeSelectionResult, "affectedPaths">, GitPortError> =>
  Effect.gen(function* () {
    const { selection } = input;
    let affectedPaths: string[];
    if (selection.kind === "all") {
      affectedPaths = yield* changeAll(runner, workingDirectory, changes, input);
    } else if (selection.kind === "file") {
      affectedPaths = yield* changeFile(runner, workingDirectory, changes, { ...input, selection });
    } else {
      affectedPaths = yield* changeHunk(runner, workingDirectory, changes, { ...input, selection });
    }
    return { affectedPaths };
  });
