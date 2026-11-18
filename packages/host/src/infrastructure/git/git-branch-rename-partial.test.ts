import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { GitCommandRunner } from "./git-command-runner";
import { renameCheckedOutBranch } from "./git-branch-rename";

/**
 * A Git runner whose `branch -m` moves the ref, then fails before it moves HEAD, as Git can when a
 * later write fails.
 */
const partialRenameRunner = () => {
  const refs = new Map([["refs/heads/odt/1a2b3c4d", "c0ffee"]]);
  const head = { ref: "refs/heads/odt/1a2b3c4d" };
  const ok = (stdout = "") => Effect.succeed({ stdout, stderr: "", ok: true });
  const failed = (stderr: string) => Effect.succeed({ stdout: "", stderr, ok: false });
  const runner: GitCommandRunner = (_directory, args) => {
    const [command, ...rest] = args;
    if (command === "symbolic-ref") return ok(head.ref);
    if (command === "for-each-ref") {
      const lines = rest
        .slice(1)
        .flatMap((ref) =>
          refs.has(ref) ? [[ref, head.ref === ref ? "*" : " ", refs.get(ref), "", "", ""]] : [],
        )
        .map((fields) => fields.join("\0"));
      return ok(lines.join("\n"));
    }
    if (command === "branch") {
      const [, from, to] = rest;
      refs.set(`refs/heads/${to}`, refs.get(`refs/heads/${from}`) ?? "");
      refs.delete(`refs/heads/${from}`);
      return failed("fatal: could not update HEAD");
    }
    return Effect.die(new Error(`Unexpected Git command: ${args.join(" ")}`));
  };
  return { runner, refs, head };
};

test("reports the actual checkout when Git stops part way through a rename", async () => {
  const { runner } = partialRenameRunner();
  const rename = (from: string, to: string) =>
    Effect.runPromise(renameCheckedOutBranch(runner, "/worktree", from, to));

  await expect(rename("odt/1a2b3c4d", "fix/login")).rejects.toThrow(
    "Git stopped part way through the rename of branch odt/1a2b3c4d to fix/login: fatal: could not update HEAD The worktree /worktree now has branch odt/1a2b3c4d checked out. Branch odt/1a2b3c4d does not exist, and branch fix/login exists.",
  );
  // The old branch is gone, so a second rename refuses instead of renaming an unborn HEAD.
  await expect(rename("odt/1a2b3c4d", "odt/fix-login")).rejects.toThrow(
    "no longer has branch odt/1a2b3c4d checked out",
  );
});
