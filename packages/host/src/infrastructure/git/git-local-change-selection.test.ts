import { expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import type { GitLocalChangesData } from "../../ports/git-port";
import type { GitCommandRunner } from "./git-command-runner";
import { changeLocalSelection } from "./git-local-change-selection";
import { STALE_SELECTION_MESSAGE } from "./git-local-changes";

const header = [
  "diff --git a/app.txt b/app.txt",
  "index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644",
  "--- a/app.txt",
  "+++ b/app.txt",
  "",
].join("\n");
const firstHunk = "@@ -1 +1 @@\n-line 1\n+first chunk\n";
const secondHunk = "@@ -20 +20 @@\n-line 20\n+second chunk\n";

test("refuses a chunk when the patch to apply holds other chunks than the reviewed diff", async () => {
  const commands: string[][] = [];
  // Git returns both chunks, but the reviewed diff showed only the second one.
  const runner: GitCommandRunner = (_workingDirectory, args) => {
    commands.push(args);
    return Effect.succeed({ ok: true, stdout: `${header}${firstHunk}${secondHunk}`, stderr: "" });
  };
  const changes: GitLocalChangesData = {
    currentBranch: { name: "main", detached: false },
    fileStatuses: [],
    unstaged: {
      fileStatuses: [{ path: "app.txt", status: "modified", staged: false }],
      fileDiffs: [
        {
          file: "app.txt",
          type: "modified",
          additions: 1,
          deletions: 1,
          diff: `${header}${secondHunk}`,
        },
      ],
    },
    staged: { fileStatuses: [], fileDiffs: [] },
    conflicted: { fileStatuses: [], fileDiffs: [] },
    upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
  };

  const exit = await Effect.runPromiseExit(
    changeLocalSelection(runner, "/repo", changes, {
      action: "discard",
      group: "unstaged",
      selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
    }),
  );

  expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded").toContain(
    STALE_SELECTION_MESSAGE,
  );
  expect(commands.map((args) => args[0])).toEqual(["diff"]);
});
