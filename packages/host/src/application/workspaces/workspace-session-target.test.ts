import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { validateWorkspaceSessionTarget } from "./workspace-session-target";

test("rejects a saved worktree target that resolves to the repository root", async () => {
  const git = createGitPortTestDouble({
    canonicalizePath: (path) => Effect.succeed(path),
    isGitRepository: () => Effect.succeed(true),
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
    "Workspace Session worktree resolves to the Workspace repository root: /repo. Select a session that uses a worktree.",
  );
});
