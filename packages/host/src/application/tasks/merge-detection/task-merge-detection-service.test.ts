import { describe, expect, test } from "bun:test";
import {
  repoConfigSchema,
  type TaskCard,
  type TaskMergeStatusSnapshot,
  type WorkspaceCatalog,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HostOperationError } from "../../../effect/host-errors";
import type { GitPort, GitReflogEntry, GitRefTip } from "../../../ports/git-port";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
} from "../../../test-support/service-test-doubles";
import type { RemoteFetchService } from "../../git/remote-fetch-service";
import { createTaskMergeDetectionService } from "./task-merge-detection-service";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "human_review",
  priority: 2,
  issueType: "task",
  removeWorktreeOnClose: null,
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    build: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const branchTip = (name: string, oid: string, worktreePath: string | null = null): GitRefTip => ({
  ref: `refs/heads/${name}`,
  oid,
  treeOid: `${oid}-tree`,
  worktreePath,
});

const targetTip: GitRefTip = {
  ref: "refs/remotes/origin/main",
  oid: "target-1",
  treeOid: "target-tree",
  worktreePath: null,
};

const emptyCatalog: WorkspaceCatalog = {
  openWorkspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
};

const workspace: WorkspaceRecord = {
  workspaceId: "repo",
  workspaceName: "Repo",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
};

const openCatalog: WorkspaceCatalog = { ...emptyCatalog, openWorkspaces: [workspace] };

type Harness = {
  tasks?: TaskCard[];
  directMergeTaskIds?: string[];
  branchTips?: GitRefTip[];
  gitPort?: Partial<GitPort>;
  remoteFetch?: RemoteFetchService["fetch"];
  catalog?: WorkspaceCatalog;
  listTasks?: () => Effect.Effect<TaskCard[], HostOperationError>;
};

const createHarness = ({
  tasks = [task()],
  directMergeTaskIds = [],
  branchTips = [branchTip("odt/task-1", "branch-1")],
  gitPort = {},
  remoteFetch,
  catalog = openCatalog,
  listTasks,
}: Harness = {}) => {
  const gitCalls: string[] = [];
  const snapshots: TaskMergeStatusSnapshot[] = [];
  const logs: string[] = [];
  let listTaskCalls = 0;
  const record =
    <A>(name: string, value: A) =>
    () =>
      Effect.sync(() => {
        gitCalls.push(name);
        return value;
      });
  const service = createTaskMergeDetectionService({
    taskStore: {
      listTasks: () => {
        listTaskCalls += 1;
        return listTasks ? listTasks() : Effect.succeed(tasks);
      },
      listDirectMergeTaskIds: () => Effect.succeed(directMergeTaskIds),
    },
    gitPort: createGitPortTestDouble({
      canonicalizePath: (value: string) => Effect.succeed(value),
      listRefTips: (_repoPath: string, patterns: string[]) =>
        Effect.sync(() => {
          gitCalls.push(`listRefTips:${patterns.join(",")}`);
          return patterns[0]?.startsWith("refs/heads/odt/") ? branchTips : [targetTip];
        }),
      countCommitsAhead: (_repoPath: string, base: string, patterns: string[]) =>
        Effect.sync(() => {
          gitCalls.push(`ahead:${base}:${patterns.join(",")}`);
          return new Map(branchTips.map((tip) => [tip.ref, 2]));
        }),
      isAncestor: record("isAncestor", false),
      mergeTreeOids: (_repoPath: string, pairs: readonly { first: string; second: string }[]) =>
        Effect.sync(() => {
          gitCalls.push("mergeTree");
          return pairs.map(() => "target-tree");
        }),
      readReflogs: (_repoPath: string, refs: readonly string[]) =>
        Effect.sync(() => {
          gitCalls.push("reflog");
          return new Map(
            refs.map((ref) => [ref, [{ oid: "branch-1", subject: "commit: change" }]]),
          );
        }),
      ...gitPort,
    }),
    remoteFetch: {
      fetch: (input) =>
        Effect.suspend(() => {
          gitCalls.push(`fetch:${input.remote}:${input.force}`);
          return remoteFetch ? remoteFetch(input) : Effect.succeed({ outcome: "fresh" as const });
        }),
    },
    settingsConfig: createSettingsConfigTestDouble({
      join: (...parts: string[]) => parts.join("/"),
      pathExists: () => Effect.succeed(true),
      resolveConfiguredPath: (value: string) => value,
    }),
    workspaceSettingsService: {
      getRepoConfigByRepoPath: (repoPath: string) =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath,
            worktreeBasePath: "/worktrees",
            defaultTargetBranch: { remote: "origin", branch: "main" },
          }),
        ),
      getWorkspaceCatalog: () => Effect.succeed(catalog),
    },
    publish: (snapshot) => snapshots.push(snapshot),
    logger: { error: (message) => Effect.sync(() => logs.push(message)) },
  });
  return { service, gitCalls, snapshots, logs, listTaskCalls: () => listTaskCalls };
};

const runPass = (harness: ReturnType<typeof createHarness>) =>
  Effect.runPromise(harness.service.runPass("/repo"));

describe("task merge detection service", () => {
  test("a workspace without candidates makes no Git call and publishes nothing", async () => {
    const harness = createHarness({
      tasks: [task({ status: "open" }), task({ id: "task-2", status: "closed" })],
    });

    expect(await runPass(harness)).toEqual({ repoPath: "/repo", tasks: [] });
    expect(harness.gitCalls).toEqual([]);
    expect(harness.snapshots).toEqual([]);
  });

  test("fetches each remote once and skips tasks without a branch or with a pending direct merge", async () => {
    const harness = createHarness({
      tasks: [
        task(),
        task({ id: "task-2" }),
        task({ id: "task-3" }),
        task({ id: "task-4", targetBranch: { remote: "origin", branch: "release" } }),
      ],
      branchTips: [
        branchTip("odt/task-1", "branch-1"),
        branchTip("odt/task-2", "branch-2"),
        branchTip("odt/task-4-release", "branch-4"),
      ],
      directMergeTaskIds: ["task-2"],
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks.map((status) => status.taskId)).toEqual(["task-1", "task-4"]);
    // The fetch updates every branch of the remote, and a scheduled pass does not force it.
    expect(harness.gitCalls.filter((call) => call.startsWith("fetch:"))).toEqual([
      "fetch:origin:false",
    ]);
  });

  test("one Git call reads the reflogs, one per target tip counts the commits, and one writes the merge trees", async () => {
    const treePairs: { first: string; second: string }[][] = [];
    const reflogRefs: string[][] = [];
    const tips = [
      branchTip("odt/task-1", "branch-1"),
      branchTip("odt/task-2", "branch-2"),
      branchTip("odt/task-3", "branch-3"),
    ];
    const harness = createHarness({
      tasks: [task(), task({ id: "task-2" }), task({ id: "task-3" })],
      branchTips: tips,
      gitPort: {
        readReflogs: (_repoPath: string, refs: readonly string[]) =>
          Effect.sync(() => {
            reflogRefs.push([...refs]);
            return new Map(refs.map((ref) => [ref, [{ oid: "own", subject: "commit: work" }]]));
          }),
        countCommitsAhead: (_repoPath: string, base: string, patterns: string[]) =>
          Effect.sync(() => {
            harness.gitCalls.push(`ahead:${base}:${patterns.join(",")}`);
            return new Map(tips.map((tip) => [tip.ref, tip.ref.endsWith("task-1") ? 0 : 2]));
          }),
        mergeTreeOids: (_repoPath: string, pairs: readonly { first: string; second: string }[]) =>
          Effect.sync(() => {
            treePairs.push([...pairs]);
            return pairs.map((pair) => (pair.second === "branch-2" ? "target-tree" : null));
          }),
      },
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks.map((status) => status.result)).toEqual([
      expect.objectContaining({ kind: "merged" }),
      expect.objectContaining({ kind: "merged" }),
      expect.objectContaining({ kind: "not_merged", unmergedCommitCount: 2 }),
    ]);
    expect(reflogRefs).toEqual([
      ["refs/heads/odt/task-1", "refs/heads/odt/task-2", "refs/heads/odt/task-3"],
    ]);
    // The count matches the task branches by their prefix, so the command line stays short.
    expect(harness.gitCalls.filter((call) => call.startsWith("ahead:"))).toEqual([
      "ahead:target-1:refs/heads/odt/",
    ]);
    // Only the branches that the target does not hold need a tree check.
    expect(treePairs).toEqual([
      [
        { first: "target-1", second: "branch-2" },
        { first: "target-1", second: "branch-3" },
      ],
    ]);
  });

  test("a failed reflog read fails the tasks with a new tip, with one log line", async () => {
    const harness = createHarness({
      tasks: [task(), task({ id: "task-2" })],
      branchTips: [branchTip("odt/task-1", "branch-1"), branchTip("odt/task-2", "branch-2")],
      gitPort: {
        readReflogs: () =>
          Effect.fail(new HostOperationError({ operation: "test", message: "reflog failed" })),
      },
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks.map((status) => status.failure?.message)).toEqual([
      "reflog failed",
      "reflog failed",
    ]);
    expect(harness.logs).toEqual([expect.stringContaining("tasks task-1, task-2: reflog failed")]);
    expect(harness.gitCalls.filter((call) => call.startsWith("ahead:"))).toEqual([]);
  });

  test("a failed tree check fails only the tasks that need it", async () => {
    const tips = [branchTip("odt/task-1", "branch-1"), branchTip("odt/task-2", "branch-2")];
    const harness = createHarness({
      tasks: [task(), task({ id: "task-2" })],
      branchTips: tips,
      gitPort: {
        countCommitsAhead: () =>
          Effect.succeed(new Map(tips.map((tip) => [tip.ref, tip.ref.endsWith("task-1") ? 0 : 2]))),
        mergeTreeOids: () =>
          Effect.fail(new HostOperationError({ operation: "test", message: "merge-tree failed" })),
      },
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks[0]).toMatchObject({ result: { kind: "merged" } });
    expect(snapshot.tasks[0]?.failure).toBeUndefined();
    expect(snapshot.tasks[1]).toMatchObject({ failure: { message: "merge-tree failed" } });
    expect(harness.logs).toEqual([expect.stringContaining("tasks task-2: merge-tree failed")]);
  });

  test("detects a tree merge and counts the commits of a branch that is not merged", async () => {
    const merged = createHarness();
    // The result names the branch tip that it checked.
    expect((await runPass(merged)).tasks[0]?.result).toMatchObject({
      kind: "merged",
      branchOid: "branch-1",
    });

    const open = createHarness({
      gitPort: {
        mergeTreeOids: (_repoPath: string, pairs: readonly unknown[]) =>
          Effect.succeed(pairs.map(() => "other-tree")),
      },
    });
    expect((await runPass(open)).tasks[0]?.result).toMatchObject({
      kind: "not_merged",
      unmergedCommitCount: 2,
    });
  });

  test("a branch is merged only when its reflog shows a commit of its own", async () => {
    // The branch history is base -> work -> later. A rebase onto main-2 rewrites it as
    // main-2 -> work-2 -> later-2, and target-2 follows it. The target holds the branch tip.
    const parents = new Map([
      ["work", "base"],
      ["later", "work"],
      ["main-2", "base"],
      ["work-2", "main-2"],
      ["later-2", "work-2"],
      ["target-2", "later-2"],
    ]);
    const isAncestorOf = (ancestor: string, descendant: string): boolean => {
      let current: string | undefined = descendant;
      while (current !== undefined) {
        if (current === ancestor) return true;
        current = parents.get(current);
      }
      return false;
    };
    const reflogResult = async (entries: GitReflogEntry[], branchInTarget = true) => {
      const harness = createHarness({
        gitPort: {
          isAncestor: (_repoPath: string, ancestor: string, descendant: string) =>
            Effect.succeed(
              descendant === targetTip.oid ? branchInTarget : isAncestorOf(ancestor, descendant),
            ),
          readReflogs: () => Effect.succeed(new Map([["refs/heads/odt/task-1", entries]])),
        },
      });
      const status = (await runPass(harness)).tasks[0];
      return { status, gitCalls: harness.gitCalls };
    };
    const created = { oid: "base", subject: "branch: Created from main" };

    expect(
      (await reflogResult([{ oid: "branch-1", subject: "commit: work" }, created])).status?.result,
    ).toMatchObject({ kind: "merged" });
    // Git also makes a commit of the branch's own for a cherry-pick, a revert, or an applied patch.
    for (const subject of ["cherry-pick: work", "revert: Revert work", "am: work"]) {
      expect(
        (await reflogResult([{ oid: "branch-1", subject }, created])).status?.result,
      ).toMatchObject({ kind: "merged" });
    }
    expect(
      (await reflogResult([{ oid: "branch-1", subject: "pull: Fast-forward" }, created])).status
        ?.result,
    ).toMatchObject({ kind: "not_merged", unmergedCommitCount: 0 });
    // A reset that drops the task commits leaves the branch without a commit of its own.
    expect(
      (
        await reflogResult([
          { oid: "base", subject: "reset: moving to main" },
          { oid: "work", subject: "commit: earlier work" },
          created,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "not_merged", unmergedCommitCount: 0 });
    // A reset that drops a later commit keeps the earlier task commit, so the merge counts.
    expect(
      (
        await reflogResult([
          { oid: "work", subject: "reset: moving to HEAD~1" },
          { oid: "later", subject: "commit: later work" },
          { oid: "work", subject: "commit: task work" },
          created,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "merged" });
    // A reset that keeps the task commits does not hide a merge.
    expect(
      (
        await reflogResult([
          { oid: "work", subject: "reset: moving to HEAD" },
          { oid: "work", subject: "commit: task work" },
          created,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "merged" });
    // A reset back to a dropped commit restores it.
    expect(
      (
        await reflogResult([
          { oid: "work", subject: "reset: moving to work" },
          { oid: "base", subject: "reset: moving to HEAD~1" },
          { oid: "work", subject: "commit: task work" },
          created,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "merged" });
    // A rebase rewrites the task commits, so a later reset keeps the rebased commit of its tip.
    const rebased = {
      oid: "later-2",
      subject: "rebase (finish): refs/heads/odt/task-1 onto main-2",
    };
    const beforeRebase = [
      { oid: "later", subject: "commit: later work" },
      { oid: "work", subject: "commit: task work" },
      created,
    ];
    expect(
      (
        await reflogResult([
          { oid: "work-2", subject: "reset: moving to HEAD~1" },
          rebased,
          ...beforeRebase,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "merged" });
    // A reset to a target tip that holds the rebased commits keeps them.
    expect(
      (
        await reflogResult([
          { oid: "target-2", subject: "reset: moving to origin/main" },
          rebased,
          ...beforeRebase,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "merged" });
    // A reset to the rebase base drops every rebased commit.
    expect(
      (
        await reflogResult([
          { oid: "main-2", subject: "reset: moving to main-2" },
          rebased,
          ...beforeRebase,
        ])
      ).status?.result,
    ).toMatchObject({ kind: "not_merged", unmergedCommitCount: 0 });
  });

  test("a branch without its whole reflog is checked from its commits, with no failure", async () => {
    const result = async (
      contained: boolean,
      mergedTree: string,
      reflog: Map<string, GitReflogEntry[]> = new Map(),
    ) => {
      const harness = createHarness({
        gitPort: {
          readReflogs: () => Effect.succeed(reflog),
          countCommitsAhead: () =>
            Effect.succeed(new Map([["refs/heads/odt/task-1", contained ? 0 : 2]])),
          mergeTreeOids: (_repoPath: string, pairs: readonly unknown[]) =>
            Effect.succeed(pairs.map(() => mergedTree)),
        },
      });
      const status = (await runPass(harness)).tasks[0];
      return { status, logs: harness.logs };
    };

    // Git maintenance expires old entries. A tip that the target holds has nothing to merge.
    const empty = await result(true, "target-tree");
    expect(empty.status?.result).toMatchObject({ kind: "not_merged", unmergedCommitCount: 0 });
    expect(empty.status?.failure).toBeUndefined();
    expect(empty.logs).toEqual([]);
    // Commits that the target lacks are work of the branch, so the tree check still runs.
    expect((await result(false, "target-tree")).status?.result).toMatchObject({ kind: "merged" });
    expect((await result(false, "other-tree")).status?.result).toMatchObject({
      kind: "not_merged",
      unmergedCommitCount: 2,
    });
    // Maintenance can expire only the older entries, so a reflog without its creation entry is
    // checked the same way.
    const partial = new Map([
      [
        "refs/heads/odt/task-1",
        [{ oid: "branch-1", subject: "merge main: Merge made by the 'ort' strategy." }],
      ],
    ]);
    expect((await result(false, "target-tree", partial)).status?.result).toMatchObject({
      kind: "merged",
    });
  });

  test("a branch without a commit of its own is not merged when the target has its tree", async () => {
    const harness = createHarness({
      gitPort: {
        readReflogs: () =>
          Effect.succeed(
            new Map([
              [
                "refs/heads/odt/task-1",
                [{ oid: "branch-1", subject: "branch: Created from main" }],
              ],
            ]),
          ),
      },
    });

    expect((await runPass(harness)).tasks[0]?.result).toMatchObject({
      kind: "not_merged",
      unmergedCommitCount: 0,
    });
    expect(harness.gitCalls).not.toContain("mergeTree");
  });

  test("checks again only the tasks whose branch or target moved", async () => {
    let tips = [branchTip("odt/task-1", "branch-1")];
    let target = targetTip;
    const harness = createHarness({
      gitPort: {
        listRefTips: (_repoPath: string, patterns: string[]) =>
          Effect.succeed(patterns[0]?.startsWith("refs/heads/odt/") ? tips : [target]),
      },
    });
    const count = (name: string) => harness.gitCalls.filter((call) => call === name).length;

    await runPass(harness);
    const unchanged = await runPass(harness);
    expect(count("mergeTree")).toBe(1);
    expect(unchanged.tasks[0]?.result).toMatchObject({ kind: "merged" });
    // A pass that changes only the check time publishes nothing.
    expect(harness.snapshots).toHaveLength(1);

    // A moved target needs a new check, but the branch reflog result stays for its tip.
    target = { ...targetTip, oid: "target-2" };
    await runPass(harness);
    expect(count("mergeTree")).toBe(2);
    expect(count("reflog")).toBe(1);

    tips = [branchTip("odt/task-1", "branch-2")];
    await runPass(harness);
    expect(count("mergeTree")).toBe(3);
    expect(count("reflog")).toBe(2);
  });

  test("shows a failure for tasks that have several branches or an invalid target", async () => {
    const harness = createHarness({
      tasks: [task(), task({ id: "task-2", targetBranchError: "Target branch JSON is invalid." })],
      branchTips: [
        branchTip("odt/task-1-a", "branch-a"),
        branchTip("odt/task-1-b", "branch-b"),
        branchTip("odt/task-2", "branch-2"),
      ],
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        branch: null,
        result: { kind: "not_checked" },
        failure: expect.objectContaining({
          message: expect.stringContaining("odt/task-1-a, odt/task-1-b"),
        }),
      }),
      expect.objectContaining({
        taskId: "task-2",
        targetBranch: null,
        failure: expect.objectContaining({ message: "Target branch JSON is invalid." }),
      }),
    ]);
  });

  test("uses the branch that the task worktree has checked out", async () => {
    const harness = createHarness({
      branchTips: [
        branchTip("odt/task-1-old", "branch-old"),
        branchTip("odt/task-1-new", "branch-new", "/worktrees/task-1"),
      ],
    });

    expect((await runPass(harness)).tasks[0]?.branch).toBe("odt/task-1-new");
  });

  test("a pass failure keeps each last result, adds the failure, and fails the pass", async () => {
    let failList = false;
    const harness = createHarness({
      listTasks: () =>
        failList
          ? Effect.fail(new HostOperationError({ operation: "test", message: "Store is busy." }))
          : Effect.succeed([task()]),
    });
    await runPass(harness);
    failList = true;

    const failure = await Effect.runPromise(Effect.flip(harness.service.runPass("/repo")));

    expect(failure.message).toBe("Store is busy.");
    expect(await Effect.runPromise(harness.service.getSnapshot("/repo"))).toMatchObject({
      tasks: [
        {
          taskId: "task-1",
          result: { kind: "merged" },
          failure: { message: "Store is busy." },
        },
      ],
    });
    expect(harness.snapshots).toHaveLength(2);
  });

  test("a call during a pass of the same workspace joins that pass", async () => {
    const harness = createHarness({
      listTasks: () => Effect.sleep("1 second").pipe(Effect.as([task()])),
    });

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const firstFiber = yield* Effect.forkChild(harness.service.runPass("/repo"));
        const secondFiber = yield* Effect.forkChild(harness.service.runPass("/repo"));
        yield* TestClock.adjust("1 second");
        return [yield* Fiber.join(firstFiber), yield* Fiber.join(secondFiber)] as const;
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(second).toEqual(first);
    expect(harness.listTaskCalls()).toBe(1);
  });

  test("a failed fetch fails the tasks of that remote", async () => {
    const harness = createHarness({
      remoteFetch: () =>
        Effect.fail(
          new HostOperationError({ operation: "git.fetch", message: "git fetch origin failed." }),
        ),
    });

    const snapshot = await runPass(harness);

    expect(snapshot.tasks[0]?.failure?.message).toBe("git fetch origin failed.");
    expect(harness.logs).toEqual([expect.stringContaining("remote origin")]);
    expect(harness.gitCalls).not.toContain("mergeTree");
  });

  test("Check again forces the fetch and checks only open workspaces", async () => {
    const closed = createHarness({ catalog: { ...emptyCatalog, closedWorkspaces: [workspace] } });
    expect(
      (await Effect.runPromise(Effect.flip(closed.service.checkWorkspace("/repo")))).message,
    ).toContain("The workspace is closed");

    const open = createHarness({ catalog: openCatalog });
    expect((await Effect.runPromise(open.service.checkWorkspace("/repo"))).tasks).toHaveLength(1);
    expect(open.gitCalls.filter((call) => call.startsWith("fetch:"))).toEqual([
      "fetch:origin:true",
    ]);
  });
});
