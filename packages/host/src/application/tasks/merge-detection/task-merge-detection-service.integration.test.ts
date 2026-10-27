import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  repoConfigSchema,
  type TaskCard,
  type TaskMergeStatus,
  type TaskMergeStatusSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../../adapters/git/git-cli-adapter";
import { gitFixtureEnv } from "../../../test-support/git-repository-fixture";
import { createSettingsConfigTestDouble } from "../../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../../test-support/temp-directory";
import { createRemoteFetchService } from "../../git/remote-fetch-service";
import { createTaskMergeDetectionService } from "./task-merge-detection-service";

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitFixtureEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const taskCard = (id: string): TaskCard => ({
  id,
  title: id,
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
});

let root: string;
let repo: string;
let other: string;
let worktreeBase: string;

const commitFile = async (cwd: string, name: string, content: string) => {
  await writeFile(path.join(cwd, name), content);
  run(cwd, "add", name);
  run(cwd, "commit", "-m", `change ${name}`);
};

const configureGit = (cwd: string) => {
  run(cwd, "config", "user.name", "Merge Detection Test");
  run(cwd, "config", "user.email", "merge-detection@example.invalid");
  run(cwd, "config", "commit.gpgsign", "false");
};

const createService = (tasks: TaskCard[]) => {
  const gitPort = createGitCliAdapter({
    resolveCommand: () => Effect.succeed("git"),
    readEnv: () => gitFixtureEnv,
  });
  const snapshots: TaskMergeStatusSnapshot[] = [];
  const logs: string[] = [];
  const service = createTaskMergeDetectionService({
    taskStore: {
      listTasks: () => Effect.succeed(tasks),
      listDirectMergeTaskIds: () => Effect.succeed([]),
    },
    gitPort,
    remoteFetch: createRemoteFetchService(gitPort),
    settingsConfig: createSettingsConfigTestDouble({
      canonicalizePath: (value: string) => Effect.promise(() => realpath(value)),
      join: (...parts: string[]) => path.join(...parts),
      pathExists: (value: string) =>
        Effect.promise(() =>
          stat(value).then(
            () => true,
            () => false,
          ),
        ),
      resolveConfiguredPath: (value: string) => value,
    }),
    workspaceSettingsService: {
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: repo,
            worktreeBasePath: worktreeBase,
            defaultTargetBranch: { remote: "origin", branch: "main" },
          }),
        ),
      getWorkspaceCatalog: () =>
        Effect.succeed({
          openWorkspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              abbreviation: null,
              tileColor: null,
              repoPath: "/workspace",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
          closedWorkspaces: [],
          incompleteRemovals: [],
        }),
    },
    publish: (snapshot) => snapshots.push(snapshot),
    logger: { error: (message) => Effect.sync(() => logs.push(message)) },
  });
  return { service, snapshots, logs };
};

const resultsByTask = (snapshot: TaskMergeStatusSnapshot) =>
  Object.fromEntries(
    snapshot.tasks.map((status: TaskMergeStatus) => [
      status.taskId,
      status.result.kind === "not_merged"
        ? `not_merged:${status.result.unmergedCommitCount}`
        : status.result.kind,
    ]),
  );

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "merge-detection-")));
  const origin = path.join(root, "origin.git");
  repo = path.join(root, "repo");
  other = path.join(root, "other");
  worktreeBase = path.join(root, "worktrees");
  run(root, "init", "--bare", "--initial-branch=main", origin);
  run(root, "init", "--initial-branch=main", repo);
  configureGit(repo);
  await commitFile(repo, "base.txt", "base\n");
  run(repo, "remote", "add", "origin", origin);
  run(repo, "push", "-u", "origin", "main");
  run(root, "clone", origin, other);
  configureGit(other);
});

afterEach(async () => {
  await removeTestDirectory(root);
});

describe("merge detection with real Git", () => {
  // Each case creates repositories and starts many Git processes, which can exceed 5 seconds.
  test("finds each merge type and tells branches without commits apart", async () => {
    const createTaskBranch = async (taskId: string, withCommit: boolean) => {
      run(repo, "branch", `odt/${taskId}`, "origin/main");
      if (!withCommit) return;
      run(repo, "checkout", `odt/${taskId}`);
      await commitFile(repo, `${taskId}.txt`, `${taskId}\n`);
      run(repo, "checkout", "main");
    };
    for (const taskId of ["t-merge", "t-ff", "t-squash", "t-rebase", "t-open"]) {
      await createTaskBranch(taskId, true);
    }
    // A branch without commits that a Git panel pull moved forward.
    run(repo, "worktree", "add", "-b", "odt/t-empty", path.join(worktreeBase, "t-empty"), "main");
    run(repo, "push", "origin", "odt/t-merge", "odt/t-ff", "odt/t-squash", "odt/t-rebase");

    run(other, "fetch", "origin");
    run(other, "merge", "--ff-only", "origin/odt/t-ff");
    run(other, "merge", "--no-ff", "-m", "Merge t-merge", "origin/odt/t-merge");
    run(other, "merge", "--squash", "origin/odt/t-squash");
    run(other, "commit", "-m", "Squash t-squash");
    run(other, "cherry-pick", "origin/odt/t-rebase");
    run(other, "push", "origin", "main");
    run(repo, "fetch", "origin");
    run(path.join(worktreeBase, "t-empty"), "merge", "--ff-only", "origin/main");

    const tasks = ["t-merge", "t-ff", "t-squash", "t-rebase", "t-open", "t-empty"].map(taskCard);
    const { service, snapshots, logs } = createService(tasks);
    const first = await Effect.runPromise(service.runPass("/workspace"));

    expect(logs).toEqual([]);
    expect(resultsByTask(first)).toEqual({
      "t-merge": "merged",
      "t-ff": "merged",
      "t-squash": "merged",
      "t-rebase": "merged",
      "t-open": "not_merged:1",
      "t-empty": "not_merged:0",
    });
    expect(first.tasks.find((status) => status.taskId === "t-empty")?.branch).toBe("odt/t-empty");
    expect(snapshots).toEqual([first]);

    // A new commit on a merged branch makes it not merged again.
    run(repo, "checkout", "odt/t-ff");
    await commitFile(repo, "t-ff-more.txt", "more\n");
    run(repo, "checkout", "main");
    const second = await Effect.runPromise(service.runPass("/workspace"));
    expect(resultsByTask(second)).toMatchObject({ "t-ff": "not_merged:1", "t-merge": "merged" });
  }, 30_000);

  test("checks branches whose reflog Git maintenance expired, without a failure", async () => {
    run(repo, "branch", "odt/t-idle", "origin/main");
    for (const taskId of ["t-squash", "t-open"]) {
      run(repo, "checkout", "-b", `odt/${taskId}`, "origin/main");
      await commitFile(repo, `${taskId}.txt`, `${taskId}\n`);
    }
    run(repo, "checkout", "main");
    run(repo, "push", "origin", "odt/t-squash");
    run(other, "fetch", "origin");
    run(other, "merge", "--squash", "origin/odt/t-squash");
    run(other, "commit", "-m", "Squash t-squash");
    run(other, "push", "origin", "main");
    run(repo, "fetch", "origin");
    // `git gc` expires old reflog entries in the same way, and leaves empty reflog files.
    run(repo, "reflog", "expire", "--expire=now", "--all");

    const { service, logs } = createService(["t-idle", "t-squash", "t-open"].map(taskCard));
    const snapshot = await Effect.runPromise(service.runPass("/workspace"));

    expect(logs).toEqual([]);
    expect(snapshot.tasks.every((status) => status.failure === undefined)).toBe(true);
    expect(resultsByTask(snapshot)).toEqual({
      "t-idle": "not_merged:0",
      "t-squash": "merged",
      "t-open": "not_merged:1",
    });
  }, 30_000);

  test("needs a commit that the branch kept, on both merge paths", async () => {
    // A reset to the same commit keeps the task commit, so its merge still counts.
    run(repo, "checkout", "-b", "odt/t-reset", "origin/main");
    await commitFile(repo, "t-reset.txt", "reset\n");
    run(repo, "reset", "--hard", "HEAD");
    run(repo, "checkout", "main");
    run(repo, "push", "origin", "odt/t-reset");
    // A reset that drops a later commit keeps the earlier task commit.
    run(repo, "checkout", "-b", "odt/t-partial", "origin/main");
    await commitFile(repo, "t-partial-a.txt", "a\n");
    await commitFile(repo, "t-partial-b.txt", "b\n");
    run(repo, "reset", "--hard", "HEAD~1");
    run(repo, "checkout", "main");
    run(repo, "push", "origin", "odt/t-partial");
    // A cherry-pick makes a commit of the branch's own.
    run(repo, "checkout", "-b", "side", "origin/main");
    await commitFile(repo, "side.txt", "side\n");
    run(repo, "checkout", "-b", "odt/t-pick", "origin/main");
    run(repo, "cherry-pick", "side");
    run(repo, "checkout", "main");
    run(repo, "push", "origin", "odt/t-pick");
    run(other, "fetch", "origin");
    run(other, "merge", "--ff-only", "origin/odt/t-reset");
    run(other, "merge", "--no-ff", "-m", "Merge t-partial", "origin/odt/t-partial");
    run(other, "merge", "--no-ff", "-m", "Merge t-pick", "origin/odt/t-pick");
    run(other, "push", "origin", "main");
    run(repo, "fetch", "origin");
    run(repo, "merge", "--ff-only", "origin/main");
    // A release branch gets the change of main by cherry-pick. A task branch that starts at main
    // and gets no commit leaves the release tree unchanged, but it is not merged.
    await commitFile(repo, "shared.txt", "shared\n");
    run(repo, "push", "origin", "main");
    run(repo, "checkout", "-b", "release", "main~1");
    run(repo, "cherry-pick", "main");
    run(repo, "push", "origin", "release");
    run(repo, "checkout", "main");
    run(repo, "branch", "odt/t-cherry", "main");

    const { service, logs } = createService([
      taskCard("t-reset"),
      taskCard("t-partial"),
      taskCard("t-pick"),
      { ...taskCard("t-cherry"), targetBranch: { remote: "origin", branch: "release" } },
    ]);
    const snapshot = await Effect.runPromise(service.runPass("/workspace"));

    expect(logs).toEqual([]);
    expect(resultsByTask(snapshot)).toEqual({
      "t-reset": "merged",
      "t-partial": "merged",
      "t-pick": "merged",
      "t-cherry": "not_merged:0",
    });
  }, 30_000);

  test("keeps the last result and shows a failure when the fetch fails", async () => {
    run(repo, "branch", "odt/t-open", "origin/main");
    run(repo, "checkout", "odt/t-open");
    await commitFile(repo, "t-open.txt", "open\n");
    run(repo, "checkout", "main");
    const { service, logs } = createService([taskCard("t-open")]);
    const first = await Effect.runPromise(service.runPass("/workspace"));
    expect(first.tasks[0]?.result.kind).toBe("not_merged");

    run(repo, "remote", "set-url", "origin", path.join(root, "missing.git"));
    // A scheduled pass reuses the fetch of the first pass, so Check again forces a new one.
    const scheduled = await Effect.runPromise(service.runPass("/workspace"));
    expect(scheduled.tasks[0]?.failure).toBeUndefined();
    const second = await Effect.runPromise(service.checkWorkspace("/workspace"));

    expect(second.tasks[0]).toMatchObject({
      taskId: "t-open",
      result: { kind: "not_merged", unmergedCommitCount: 1 },
      failure: { message: expect.stringContaining("git fetch origin failed") },
    });
    expect(logs).toEqual([expect.stringContaining("remote origin")]);
  }, 30_000);
});
