import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import type { GitCommandRunner } from "./git-command-runner";
import { readHistoryPage } from "./git-history";

type FakeResult = { ok: boolean; stdout?: string; stderr?: string; exitCode?: number };

/** Answers each Git command by its first argument. */
const fakeGit =
  (results: Record<string, FakeResult>): GitCommandRunner =>
  (_workingDirectory, args) => {
    const result = results[args[0] ?? ""];
    if (!result) throw new Error(`Unexpected git ${args.join(" ")}`);
    return Effect.succeed({
      ok: result.ok,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? (result.ok ? 0 : 1),
    });
  };

const readWithoutRevision = (runner: GitCommandRunner) =>
  Effect.runPromiseExit(
    readHistoryPage(runner, "/repo", {
      currentBranch: { name: "main", detached: false },
      targetReference: "refs/remotes/origin/main",
    }),
  );

const failureText = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded";

describe("History without a current revision", () => {
  test("reports no commits only for a branch that has no reference yet", async () => {
    const exit = await readWithoutRevision(
      fakeGit({
        "rev-parse": { ok: false },
        "symbolic-ref": { ok: true, stdout: "refs/heads/main\n" },
        "for-each-ref": { ok: true },
      }),
    );

    expect(exit).toEqual(Exit.succeed({ outcome: "no_commits" }));
  });

  test("reports a branch reference that Git cannot read", async () => {
    const exit = await readWithoutRevision(
      fakeGit({
        "rev-parse": {
          ok: false,
          exitCode: 128,
          stderr: "fatal: cannot read refs/heads/main: Permission denied",
        },
        "symbolic-ref": { ok: true, stdout: "refs/heads/main\n" },
        "for-each-ref": { ok: true, stderr: "warning: ignoring broken ref refs/heads/main" },
      }),
    );

    expect(failureText(exit)).toContain(
      "Git cannot read the current commit: warning: ignoring broken ref refs/heads/main Repair the branch reference, then refresh.",
    );
  });

  test("reports a detached HEAD without a commit", async () => {
    const exit = await readWithoutRevision(
      fakeGit({
        "rev-parse": { ok: false },
        "symbolic-ref": { ok: false, exitCode: 1 },
      }),
    );

    expect(failureText(exit)).toContain(
      "Git cannot read the current commit: HEAD names no branch and no commit.",
    );
  });
});
