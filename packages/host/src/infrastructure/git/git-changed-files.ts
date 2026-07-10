import { Effect } from "effect";
import type { GitCommandRunner } from "./git-command-runner";
import { requireNonEmptyEffect, runGit } from "./git-command-runner";

const nameStatusToFileStatus = (value: string): string => {
  switch (value.at(0)) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
};

export const parseChangedFiles = (output: string): Array<{ path: string; status: string }> => {
  const fields = output.split("\0");
  const files: Array<{ path: string; status: string }> = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index] ?? "";
    index += 1;
    if (!status) {
      continue;
    }
    const firstPath = fields[index] ?? "";
    index += 1;
    const isRenameOrCopy = status.startsWith("R") || status.startsWith("C");
    const path = isRenameOrCopy ? (fields[index] ?? "") : firstPath;
    if (isRenameOrCopy) {
      index += 1;
    }
    if (path) {
      files.push({ path, status: nameStatusToFileStatus(status) });
    }
  }
  return files;
};

export const loadChangedFiles = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const output = yield* runGit(runner, workingDirectory, [
      "diff",
      "--name-status",
      "-z",
      "--end-of-options",
      target,
    ]);
    return parseChangedFiles(output);
  });
