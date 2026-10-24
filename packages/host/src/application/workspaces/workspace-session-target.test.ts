import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { validateWorkspaceSessionTarget } from "./workspace-session-target";

test("rejects a saved worktree target that resolves to the repository root", async () => {
  const git = createGitPortTestDouble({
    canonicalizePath: (path) => Effect.succeed(path),
    readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
  });

  const error = await Effect.runPromise(
    Effect.flip(
      validateWorkspaceSessionTarget({ git }, "/repo", {
        kind: "local_worktree",
        workingDirectory: "/repo",
        branchName: "feature",
        worktreeState: "present",
      }),
    ),
  );

  expect(error).toBeInstanceOf(HostValidationError);
  expect(error.message).toBe(
    "The worktree of this chat is now the repository checkout: /repo. Archive this chat, or start a Current checkout chat.",
  );
});
