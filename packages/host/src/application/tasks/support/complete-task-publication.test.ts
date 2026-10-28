import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DirectMergeRecord, TaskDirectMergeCompleteIntent } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../../adapters/git/git-cli-adapter";
import { HostOperationError } from "../../../effect/host-errors";
import { createDefaultGitRunner } from "../../../infrastructure/git/git-command-runner";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import type { BoundGitPublication } from "../../../ports/git-port";
import { createTaskCompletionState } from "../task-completion-state";
import { completeTaskPublication } from "./complete-task-publication";

const target: BoundGitPublication = {
  repoPath: "/repo",
  sourceRef: "refs/heads/main",
  sourceOid: "a".repeat(40),
  remote: "origin",
  targetRef: "refs/heads/main",
  endpoints: [
    { identity: "one", label: "/one.git", url: "/one.git" },
    { identity: "two", label: "/two.git", url: "/two.git" },
  ],
};
const merge: DirectMergeRecord = {
  method: "merge_commit",
  sourceBranch: "odt/task-1",
  targetBranch: { remote: "origin", branch: "main" },
  mergedAt: "2026-10-13T12:00:00Z",
};
const consent: TaskDirectMergeCompleteIntent = {
  repoPath: "/repo",
  taskId: "task-1",
  removeWorktree: true,
  publicationConsent: {
    expectedMerge: merge,
    expectedPublication: {
      sourceOid: target.sourceOid,
      remote: target.remote,
      targetRef: target.targetRef,
      destinations: target.endpoints.map(({ identity, label }) => ({ identity, label })),
    },
  },
};
const setup = () => {
  const state = createTaskCompletionState(undefined).ensure("/repo", "task-1");
  state.appliedTargetOid = target.sourceOid;
  let observed: (string | null)[] = [null, null];
  const pushes: string[][] = [];
  const git = createGitPortTestDouble({
    isMergeIncluded: () => Effect.succeed(true),
    getCurrentBranch: () =>
      Effect.succeed({ name: "main", detached: false, revision: target.sourceOid }),
    readPublicationTarget: () => Effect.succeed(target),
    inspectPublication: () =>
      Effect.succeed(
        target.endpoints.map((endpoint, index) => ({
          destinationIdentity: endpoint.identity,
          oid: observed[index] ?? null,
        })),
      ),
    pushBoundPublication: (_repoPath, options) =>
      Effect.sync(() => {
        const identities = options.destinationIdentities;
        pushes.push(identities);
        observed = target.endpoints.map(() => target.sourceOid);
        return {
          sourceOid: target.sourceOid,
          targetRef: target.targetRef,
          destinations: target.endpoints.map((endpoint) => ({
            identity: endpoint.identity,
            outcome: "confirmed" as const,
          })),
        };
      }),
  });
  return {
    state,
    git,
    pushes,
    observe: (next: (string | null)[]) => {
      observed = next;
    },
  };
};

describe("task completion publication recovery", () => {
  test("retries only the local tracking update after confirmed publication", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "odt-tracking-recovery-"));
    const repoPath = path.join(root, "work");
    const remotePath = path.join(root, "origin.git");
    const runner = createDefaultGitRunner(
      () => ({ ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
      { command: "git" },
    );
    const git = (directory: string, ...args: string[]) =>
      Effect.runPromise(
        runner(directory, [
          "-c",
          "user.name=Publication test",
          "-c",
          "user.email=publication@example.invalid",
          ...args,
        ]),
      );
    const appliedMerge: DirectMergeRecord = { ...merge, method: "squash" };
    let failTracking = true;
    let trackingUpdates = 0;
    let pushes = 0;
    const adapter = createGitCliAdapter({
      runner: (directory, args, options) =>
        Effect.suspend(() => {
          if (args.includes("push")) pushes += 1;
          if (args[0] === "update-ref") {
            trackingUpdates += 1;
            if (failTracking)
              return Effect.fail(
                new HostOperationError({ operation: "test.update-ref", message: "Ref is locked" }),
              );
          }
          return runner(directory, args, options);
        }),
    });
    try {
      await git(root, "init", "--initial-branch=main", repoPath);
      await git(root, "init", "--bare", remotePath);
      await git(repoPath, "commit", "--allow-empty", "-m", "Base");
      await git(repoPath, "remote", "add", "origin", remotePath);
      await git(repoPath, "push", "origin", "main");
      const baseOid = (await git(repoPath, "rev-parse", "refs/remotes/origin/main")).stdout.trim();
      // Recovery starts after the squash commit was applied to the target branch.
      await writeFile(path.join(repoPath, "change.txt"), "task change\n");
      await git(repoPath, "add", "change.txt");
      await git(repoPath, "commit", "-m", "Merge task");
      const publication = await Effect.runPromise(
        adapter.readPublicationTarget({
          repoPath,
          sourceRef: "refs/heads/main",
          remote: "origin",
          targetRef: "refs/heads/main",
        }),
      );
      const state = createTaskCompletionState(undefined).ensure(repoPath, "task-1");
      state.appliedTargetOid = publication.sourceOid;
      const input: TaskDirectMergeCompleteIntent = {
        repoPath,
        taskId: "task-1",
        removeWorktree: true,
      };
      const first = await Effect.runPromise(
        Effect.result(
          completeTaskPublication(
            adapter,
            {
              ...input,
              publicationConsent: {
                expectedMerge: appliedMerge,
                expectedPublication: {
                  sourceOid: publication.sourceOid,
                  remote: publication.remote,
                  targetRef: publication.targetRef,
                  destinations: publication.endpoints.map(({ identity, label }) => ({
                    identity,
                    label,
                  })),
                },
              },
            },
            appliedMerge,
            state,
          ),
        ),
      );
      expect(first._tag).toBe("Failure");
      expect(state.progress?.destinations.map(({ outcome }) => outcome)).toEqual(["confirmed"]);
      expect((await git(remotePath, "rev-parse", "refs/heads/main")).stdout.trim()).toBe(
        publication.sourceOid,
      );
      expect((await git(repoPath, "rev-parse", "refs/remotes/origin/main")).stdout.trim()).toBe(
        baseOid,
      );
      const retry = await Effect.runPromise(
        Effect.result(completeTaskPublication(adapter, input, appliedMerge, state)),
      );
      expect(retry._tag).toBe("Failure");
      expect(trackingUpdates).toBe(2);
      expect(pushes).toBe(1);
      failTracking = false;
      await Effect.runPromise(completeTaskPublication(adapter, input, appliedMerge, state));
      expect((await git(repoPath, "rev-parse", "refs/remotes/origin/main")).stdout.trim()).toBe(
        publication.sourceOid,
      );
      expect(trackingUpdates).toBe(3);
      expect(pushes).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Real repositories, a push, and recovery reads can exceed 5 seconds on Windows CI.
  }, 15_000);

  test("requires bound consent before any remote write", async () => {
    const h = setup();
    expect(
      (
        await Effect.runPromise(
          Effect.result(
            completeTaskPublication(
              h.git,
              { repoPath: "/repo", taskId: "task-1", removeWorktree: true },
              merge,
              h.state,
            ),
          ),
        )
      )._tag,
    ).toBe("Failure");
    expect(h.pushes).toEqual([]);
    await Effect.runPromise(completeTaskPublication(h.git, consent, merge, h.state));
    expect(h.pushes).toEqual([["one", "two"]]);
  });

  test("a partial uncertain attempt never repeats either destination", async () => {
    const h = setup();
    h.state.publication = target;
    h.state.progress = {
      sourceOid: target.sourceOid,
      targetRef: target.targetRef,
      destinations: [
        { identity: "one", outcome: "confirmed" },
        { identity: "two", outcome: "uncertain" },
      ],
    };
    h.observe([target.sourceOid, null]);
    expect(
      (
        await Effect.runPromise(
          Effect.result(completeTaskPublication(h.git, consent, merge, h.state)),
        )
      )._tag,
    ).toBe("Failure");
    expect(h.pushes).toEqual([]);
    h.observe([target.sourceOid, target.sourceOid]);
    await Effect.runPromise(
      completeTaskPublication(
        h.git,
        { repoPath: "/repo", taskId: "task-1", removeWorktree: true },
        merge,
        h.state,
      ),
    );
    expect(h.pushes.flat()).toEqual([]);
    expect(h.state.progress.destinations.every((value) => value.outcome === "confirmed")).toBe(
      true,
    );
  });

  test("synchronization cannot authorize publication without the recorded merge content", async () => {
    const recordedMerge = merge;
    const h = setup();
    h.state.merge = recordedMerge;
    h.observe([target.sourceOid, target.sourceOid]);
    const result = await Effect.runPromise(
      Effect.result(
        completeTaskPublication(
          { ...h.git, isMergeIncluded: () => Effect.succeed(false) },
          consent,
          recordedMerge,
          h.state,
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        message: expect.stringContaining("cannot confirm that the current target retains"),
      },
    });
    expect(h.state.publication).toBeUndefined();
    expect(h.state.merge).toEqual(recordedMerge);
    expect(h.pushes).toEqual([]);
  });

  test("stale source consent cannot admit a push", async () => {
    const h = setup();
    const stale = {
      ...consent,
      publicationConsent: {
        ...consent.publicationConsent!,
        expectedPublication: {
          ...consent.publicationConsent!.expectedPublication,
          sourceOid: "b".repeat(40),
        },
      },
    };
    expect(
      (
        await Effect.runPromise(
          Effect.result(completeTaskPublication(h.git, stale, merge, h.state)),
        )
      )._tag,
    ).toBe("Failure");
    expect(h.pushes).toEqual([]);
  });
});
