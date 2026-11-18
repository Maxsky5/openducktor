import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { freeBranchName, readTakenBranchNames } from "./free-branch-name";

const choose = (refs: string[], remotes: string[], branch: string, reserved: string[] = []) =>
  Effect.runPromise(
    readTakenBranchNames(
      createGitPortTestDouble({
        listRefNames: () => Effect.succeed(refs),
        listRemoteNames: () => Effect.succeed(remotes),
      }),
      "/repo",
      reserved,
    ).pipe(Effect.flatMap((taken) => freeBranchName(taken, branch))),
  );

test("takes a branch on any remote whose name starts the ref, also when names overlap", async () => {
  expect(
    await choose(["refs/remotes/origin/fix/login"], ["origin", "origin/fix"], "fix/login"),
  ).toBe("fix/login-2");
});

test("reads a remote name with a slash", async () => {
  expect(await choose(["refs/remotes/team/origin/fix/login"], ["team/origin"], "fix/login")).toBe(
    "fix/login-2",
  );
});

test("takes local and reserved names, and names with a branch inside them", async () => {
  expect(await choose(["refs/heads/feat/a"], [], "feat/a")).toBe("feat/a-2");
  expect(await choose([], [], "main", ["main"])).toBe("main-2");
  expect(await choose(["refs/heads/fix/login/old"], [], "fix/login")).toBe("fix/login-2");
});

test("fails when a branch is a folder of the name", async () => {
  await expect(choose(["refs/heads/fix"], [], "fix/login")).rejects.toThrow(
    "Git cannot create branch fix/login, because the branch fix exists.",
  );
});
