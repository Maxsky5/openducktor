import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { GitService } from "./git-service-types";
import { type GitWorkspaceAdmission, withGitWorkspaceAdmission } from "./git-workspace-admission";

const unused = () => Effect.dieMessage("Unexpected call in this test.");

const createGitServiceDouble = (overrides: Partial<GitService> = {}): GitService => {
  const base: GitService = {
    abortConflict: unused,
    canonicalizePath: unused,
    commitsAheadBehind: unused,
    commitAll: unused,
    createWorktree: unused,
    fetchRemote: unused,
    getBranches: unused,
    getCurrentBranch: unused,
    getDiff: unused,
    getStatus: unused,
    getWorktreeStatus: unused,
    getWorktreeStatusSummary: unused,
    pullBranch: unused,
    pushBranch: unused,
    rebaseAbort: unused,
    rebaseBranch: unused,
    removeWorktree: unused,
    resetWorktreeSelection: unused,
    switchBranch: unused,
  };
  return Object.assign(base, overrides);
};

const createAdmissionDouble = (input: {
  assertWorkspaceAdmitsWork?: (
    repoPath: string,
  ) => Effect.Effect<void, HostValidationErrorAggregate>;
  onLease?: (repoPath: string, workingDirectory: string | undefined) => void;
}): GitWorkspaceAdmission => ({
  assertWorkspaceAdmitsWork: input.assertWorkspaceAdmitsWork ?? (() => Effect.void),
  withWorkStartLease: <A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
    workingDirectory?: string,
  ) => {
    input.onLease?.(repoPath, workingDirectory);
    return effect;
  },
});

describe("git workspace admission", () => {
  test("leases and admits a mutating call before it runs", async () => {
    const events: string[] = [];
    const service = createGitServiceDouble({
      switchBranch: (input) =>
        Effect.sync(() => {
          events.push(`switchBranch:${input.repoPath}`);
          return { name: input.branch, detached: false, revision: "abc123" };
        }),
    });
    const admission = createAdmissionDouble({
      assertWorkspaceAdmitsWork: (repoPath) =>
        Effect.sync(() => {
          events.push(`assert:${repoPath}`);
        }),
      onLease: (repoPath, workingDirectory) => {
        events.push(`lease:${repoPath}:${workingDirectory}`);
      },
    });
    const guarded = withGitWorkspaceAdmission(service, admission);

    const result = await Effect.runPromise(
      guarded.switchBranch({ branch: "main", create: false, repoPath: "/repos/a" }),
    );

    expect(result).toEqual({ name: "main", detached: false, revision: "abc123" });
    expect(events).toEqual(["lease:/repos/a:/repos/a", "assert:/repos/a", "switchBranch:/repos/a"]);
  });

  test("passes supplied Git mutation targets to the lease", async () => {
    const targets: string[] = [];
    const service = createGitServiceDouble({
      commitAll: () => Effect.succeed({ outcome: "committed", commitHash: "abc123", output: "" }),
      removeWorktree: () => Effect.succeed({ ok: true }),
    });
    const guarded = withGitWorkspaceAdmission(
      service,
      createAdmissionDouble({
        onLease: (_repoPath, workingDirectory) => {
          if (workingDirectory) targets.push(workingDirectory);
        },
      }),
    );

    await Effect.runPromise(
      guarded.commitAll({
        repoPath: "/repos/a",
        workingDir: "/worktrees/b",
        message: "Test",
      }),
    );
    await Effect.runPromise(
      guarded.removeWorktree({
        repoPath: "/repos/a",
        worktreePath: "/worktrees/b",
        force: false,
      }),
    );

    expect(targets).toEqual(["/worktrees/b", "/worktrees/b"]);
  });

  test("does not lease a read call", async () => {
    let leased = false;
    const service = createGitServiceDouble({ getBranches: () => Effect.succeed([]) });
    const guarded = withGitWorkspaceAdmission(
      service,
      createAdmissionDouble({
        onLease: () => {
          leased = true;
        },
      }),
    );

    await Effect.runPromise(guarded.getBranches({ repoPath: "/repos/a" }));

    expect(leased).toBe(false);
  });

  test("fails the call when admission rejects it and does not run the mutation", async () => {
    let ran = false;
    const service = createGitServiceDouble({
      switchBranch: () =>
        Effect.sync(() => {
          ran = true;
          return { name: "main", detached: false, revision: "abc123" };
        }),
    });
    const guarded = withGitWorkspaceAdmission(
      service,
      createAdmissionDouble({
        assertWorkspaceAdmitsWork: () =>
          Effect.fail(
            new HostValidationError({
              message: "Workspace is closed: ws",
              field: "workspaceId",
            }),
          ),
      }),
    );

    const error = await Effect.runPromise(
      Effect.flip(guarded.switchBranch({ branch: "main", create: false, repoPath: "/repos/a" })),
    );

    expect(error.message).toContain("Workspace is closed");
    expect(ran).toBe(false);
  });
});
