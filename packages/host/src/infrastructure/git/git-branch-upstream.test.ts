import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitCommandRunner } from "./git-command-runner";
import { configureBranchUpstream } from "./git-branch-upstream";

type FakeGit = {
  /** The value of the tracking ref before the setup, or null when it does not exist. */
  trackingRefOid?: string | null;
  /** The config key whose write fails. */
  failingConfigKey?: string;
  /** A fetch writes this value into the tracking ref after the setup created it. */
  fetchedOid?: string;
};

/** A Git runner that records each command and answers the upstream setup of `feat/report`. */
const fakeGit = ({ trackingRefOid = null, failingConfigKey, fetchedOid }: FakeGit) => {
  const commands: string[] = [];
  let trackingOid = trackingRefOid;
  const answer = (ok: boolean, stdout = "") =>
    Effect.succeed({ stdout, stderr: ok ? "" : "fail", ok });
  const respond = (
    args: string[],
  ): Effect.Effect<{ stdout: string; stderr: string; ok: boolean }> => {
    commands.push(args.join(" "));
    const [command, ...rest] = args;
    if (command === "rev-parse" && rest.at(-1) === "refs/heads/feat/report")
      return answer(true, "c0ffee\n");
    if (command === "rev-parse" && rest[0] === "--verify")
      return answer(trackingOid !== null, trackingOid ?? "");
    if (command === "rev-parse") return answer(true, "origin/feat/report\n");
    if (command === "update-ref" && rest[0] === "-d") {
      if (trackingOid !== rest[2]) return answer(false);
      trackingOid = null;
      return answer(true);
    }
    if (command === "update-ref") {
      if (trackingOid !== null) return answer(false);
      trackingOid = fetchedOid ?? rest[1] ?? null;
      return answer(true);
    }
    if (command === "show-ref" || command === "for-each-ref")
      return answer(
        true,
        trackingOid === null ? "" : `${trackingOid} refs/remotes/origin/feat/report\n`,
      );
    if (command === "config") return answer(rest[0] !== failingConfigKey);
    return Effect.die(new Error(`Unexpected Git command: ${args.join(" ")}`));
  };
  // Like the real runner, a failed command fails the effect unless the caller allows failure.
  const runner: GitCommandRunner = (_directory, args, options) =>
    respond(args).pipe(
      Effect.flatMap((result) =>
        result.ok || options?.allowFailure
          ? Effect.succeed(result)
          : Effect.fail(
              new HostOperationError({ message: `git ${args[0]} failed`, operation: "git" }),
            ),
      ),
    );
  return { runner, commands, trackingOid: () => trackingOid };
};

const setup = (runner: GitCommandRunner) =>
  Effect.runPromise(
    configureBranchUpstream(runner, "/repo", "/worktree", "feat/report", "origin", true),
  );

test("a generated branch creates its tracking ref before any upstream setting names it", async () => {
  const git = fakeGit({});
  await expect(setup(git.runner)).resolves.toEqual({
    ref: "refs/remotes/origin/feat/report",
    oid: "c0ffee",
  });
  const created = git.commands.findIndex((command) => command.startsWith("update-ref"));
  const configured = git.commands.findIndex((command) => command.startsWith("config"));
  expect(created).toBeGreaterThanOrEqual(0);
  expect(created).toBeLessThan(configured);
});

test("a generated branch writes no upstream setting when its tracking ref exists", async () => {
  const git = fakeGit({ trackingRefOid: "feed01" });
  await expect(setup(git.runner)).rejects.toThrow(
    "appeared after OpenDucktor chose the branch name",
  );
  expect(git.commands.some((command) => command.startsWith("config"))).toBe(false);
});

test("a failed first config write deletes the tracking ref that the setup created", async () => {
  const git = fakeGit({ failingConfigKey: "branch.feat/report.remote" });
  await expect(setup(git.runner)).rejects.toThrow("Failed configuring upstream origin/feat/report");
  expect(git.commands).toContain("update-ref -d refs/remotes/origin/feat/report c0ffee");
  expect(git.commands.some((command) => command.startsWith("config --unset-all"))).toBe(false);
  expect(git.trackingOid()).toBeNull();
});

test("a failed setup keeps a tracking ref value that a fetch wrote", async () => {
  const git = fakeGit({ failingConfigKey: "branch.feat/report.merge", fetchedOid: "feed01" });
  const failure = await setup(git.runner).catch((error: Error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain("Also failed to delete");
  expect(git.commands).toContain("update-ref -d refs/remotes/origin/feat/report c0ffee");
  expect(git.commands).toContain("config --unset-all branch.feat/report.remote");
  expect(git.trackingOid()).toBe("feed01");
});
