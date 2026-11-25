import { specPlanBuildReference } from "@openducktor/workflows/test-support";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type TaskCard,
  type TaskMergeStatus,
  type TaskMergeStatusSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../../adapters/git/git-cli-adapter";
import { gitFixtureCommand, gitFixtureEnv } from "../../../test-support/git-repository-fixture";
import { createSettingsConfigTestDouble } from "../../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../../test-support/temp-directory";
import { createRemoteFetchService } from "../../git/remote-fetch-service";
import { createTaskMergeDetectionService } from "./task-merge-detection-service";
import { repoConfigFixture } from "../../../test-support/repo-config-fixture";

const run = (cwd: string, ...args: string[]) =>
  execFileSync(
    gitFixtureCommand,
    [
      "-c",
      "user.name=Merge Detection Test",
      "-c",
      "user.email=merge-detection@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: gitFixtureEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();

const taskCard = (id: string): TaskCard => ({
  id,
  title: id,
  description: "",
  status: "human_review",
  priority: 2,
  issueType: "task",
  removeWorktreeOnClose: null,
  workflow: specPlanBuildReference(),
  workflowSteps: [],
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

let templateRoot: string;
let root: string;
let repo: string;
let worktreeBase: string;

const commitFile = async (cwd: string, name: string, content: string) => {
  await writeFile(path.join(cwd, name), content);
  run(cwd, "add", name);
  run(cwd, "commit", "-m", `change ${name}`);
};

const createService = (tasks: TaskCard[]) => {
  const gitPort = createGitCliAdapter({
    resolveCommand: () => Effect.succeed(gitFixtureCommand),
    readEnv: () => gitFixtureEnv,
  });
  const snapshots: TaskMergeStatusSnapshot[] = [];
  const logs: string[] = [];
  const service = createTaskMergeDetectionService({
    taskStore: {
      listMergeCandidates: () => Effect.succeed(tasks),
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
      getRepoConfig: () =>
        Effect.succeed(
          repoConfigFixture({
            repoPath: repo,
            worktreeBasePath: worktreeBase,
          }),
        ),
      getWorkspaceCatalog: () =>
        Effect.succeed({
          catalogRevision: 0,
          openWorkspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              abbreviation: null,
              tileColor: null,
              repoPath: repo,
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

beforeAll(async () => {
  templateRoot = await mkdtemp(path.join(tmpdir(), "merge-detection-template-"));
  const seed = path.join(templateRoot, "seed");
  run(templateRoot, "init", "--template=", "--initial-branch=main", seed);
  await commitFile(seed, "base.txt", "base\n");
  run(templateRoot, "clone", "--bare", "--template=", seed, path.join(templateRoot, "origin.git"));
});

afterAll(async () => {
  await removeTestDirectory(templateRoot);
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "merge-detection-")));
  repo = path.join(root, "repo");
  worktreeBase = path.join(root, "worktrees");
});

const createRepository = async () => {
  const origin = path.join(root, "origin.git");
  await cp(path.join(templateRoot, "origin.git"), origin, { recursive: true });
  run(root, "clone", "--template=", "--origin=origin", origin, repo);
};

afterEach(async () => {
  await removeTestDirectory(root);
});

describe("merge detection with real Git", () => {
  // Each case creates repositories and starts many Git processes, which can exceed 5 seconds.
  test("finds merge types as branches advance and after Git expires reflogs", async () => {
    await createRepository();
    run(repo, "branch", "odt/t-idle", "origin/main");
    for (const taskId of ["t-merge", "t-ff", "t-squash", "t-rebase", "t-open"]) {
      run(repo, "checkout", "-b", `odt/${taskId}`, "origin/main");
      await commitFile(repo, `${taskId}.txt`, `${taskId}\n`);
    }
    // A new task starts with the same tree as release, but has no commit of its own.
    run(repo, "branch", "odt/t-cherry", "odt/t-ff");
    run(repo, "checkout", "-b", "release", "origin/main");
    run(repo, "cherry-pick", "-x", "odt/t-ff");

    // Publish the merged target without moving the checkout's main or its tracking refs.
    run(repo, "checkout", "-b", "merged-main", "origin/main");
    run(repo, "merge", "--ff-only", "odt/t-ff");
    run(repo, "merge", "--no-ff", "-m", "Merge t-merge", "odt/t-merge");
    run(repo, "merge", "--squash", "odt/t-squash");
    run(repo, "commit", "-m", "Squash t-squash");
    run(repo, "cherry-pick", "odt/t-rebase");
    run(repo, "push", path.join(root, "origin.git"), "merged-main:refs/heads/main", "release");
    run(repo, "checkout", "main");

    // A branch without commits that a Git panel pull moved forward.
    const empty = path.join(worktreeBase, "t-empty");
    run(repo, "worktree", "add", "-b", "odt/t-empty", empty, "main");
    run(empty, "merge", "--ff-only", "merged-main");

    const tasks = [
      ...["t-merge", "t-ff", "t-squash", "t-rebase", "t-open", "t-empty"].map(taskCard),
      { ...taskCard("t-cherry"), targetBranch: { remote: "origin", branch: "release" } },
    ];
    const { service, snapshots, logs } = createService(tasks);
    const first = await Effect.runPromise(service.runPass({ workspaceId: "repo", repoPath: repo }));

    expect(logs).toEqual([]);
    expect(resultsByTask(first)).toEqual({
      "t-merge": "merged",
      "t-ff": "merged",
      "t-squash": "merged",
      "t-rebase": "merged",
      "t-open": "not_merged:1",
      "t-empty": "not_merged:0",
      "t-cherry": "not_merged:0",
    });
    expect(first.tasks.find((status) => status.taskId === "t-empty")?.branch).toBe("odt/t-empty");
    expect(first.tasks.find((status) => status.taskId === "t-cherry")?.targetBranch).toEqual({
      remote: "origin",
      branch: "release",
    });
    expect(snapshots).toEqual([first]);

    // A new commit on a merged branch makes it not merged again.
    run(repo, "checkout", "odt/t-ff");
    await commitFile(repo, "t-ff-more.txt", "more\n");
    run(repo, "checkout", "main");
    const second = await Effect.runPromise(
      service.runPass({ workspaceId: "repo", repoPath: repo }),
    );
    expect(resultsByTask(second)).toMatchObject({ "t-ff": "not_merged:1", "t-merge": "merged" });

    // `git gc` expires old reflog entries in the same way, and leaves empty reflog files.
    run(repo, "reflog", "expire", "--expire=now", "--all");

    const expired = createService(["t-idle", "t-squash", "t-open"].map(taskCard));
    const snapshot = await Effect.runPromise(
      expired.service.runPass({ workspaceId: "repo", repoPath: repo }),
    );

    expect(expired.logs).toEqual([]);
    expect(snapshot.tasks.every((status) => status.failure === undefined)).toBe(true);
    expect(resultsByTask(snapshot)).toEqual({
      "t-idle": "not_merged:0",
      "t-squash": "merged",
      "t-open": "not_merged:1",
    });
  }, 30_000);

  test("finds merged commits kept after resets and cherry-picks", async () => {
    await createRepository();
    // A reset to the same commit keeps the task commit, so its merge still counts.
    run(repo, "checkout", "-b", "odt/t-reset", "origin/main");
    await commitFile(repo, "t-reset.txt", "reset\n");
    run(repo, "reset", "--hard", "HEAD");
    // A reset that drops a later commit keeps the earlier task commit.
    run(repo, "checkout", "-b", "odt/t-partial", "origin/main");
    await commitFile(repo, "t-partial-a.txt", "a\n");
    await commitFile(repo, "t-partial-b.txt", "b\n");
    run(repo, "reset", "--hard", "HEAD~1");
    // A cherry-pick makes a commit of the branch's own.
    run(repo, "checkout", "-b", "side", "origin/main");
    await commitFile(repo, "side.txt", "side\n");
    run(repo, "checkout", "-b", "odt/t-pick", "origin/main");
    run(repo, "cherry-pick", "side");
    // A reset back to a dropped commit restores it.
    run(repo, "checkout", "-b", "odt/t-restore", "origin/main");
    await commitFile(repo, "t-restore.txt", "restore\n");
    run(repo, "reset", "--hard", "HEAD~1");
    run(repo, "reset", "--hard", "ORIG_HEAD");
    run(repo, "checkout", "main");
    run(repo, "merge", "--ff-only", "odt/t-reset");
    for (const taskId of ["t-partial", "t-pick", "t-restore"]) {
      run(repo, "merge", "--no-ff", "-m", `Merge ${taskId}`, `odt/${taskId}`);
    }
    run(repo, "push", "origin", "main");

    const { service, logs } = createService(
      ["t-reset", "t-partial", "t-pick", "t-restore"].map(taskCard),
    );
    const snapshot = await Effect.runPromise(
      service.runPass({ workspaceId: "repo", repoPath: repo }),
    );

    expect(logs).toEqual([]);
    expect(resultsByTask(snapshot)).toEqual({
      "t-reset": "merged",
      "t-partial": "merged",
      "t-pick": "merged",
      "t-restore": "merged",
    });
  }, 30_000);

  test("finds rebased commits kept after a reset within or beyond the rebased history", async () => {
    await createRepository();
    // A reset after a rebase keeps the rebased task commit that its tip holds.
    run(repo, "checkout", "-b", "rebase-base", "origin/main");
    await commitFile(repo, "rebase-base.txt", "base\n");
    run(repo, "checkout", "-b", "odt/t-rebase", "origin/main");
    await commitFile(repo, "t-rebase-a.txt", "a\n");
    await commitFile(repo, "t-rebase-b.txt", "b\n");
    run(repo, "rebase", "rebase-base");
    run(repo, "reset", "--hard", "HEAD~1");
    // A reset to the target tip after the merge keeps the rebased task commit.
    run(repo, "checkout", "-b", "odt/t-forward", "origin/main");
    await commitFile(repo, "t-forward.txt", "forward\n");
    run(repo, "rebase", "rebase-base");
    run(repo, "checkout", "main");
    run(repo, "merge", "--no-ff", "-m", "Merge t-rebase", "odt/t-rebase");
    run(repo, "merge", "--no-ff", "-m", "Merge t-forward", "odt/t-forward");
    run(repo, "push", "origin", "main");
    run(repo, "branch", "--force", "odt/t-forward", "origin/main");

    const { service, logs } = createService(["t-rebase", "t-forward"].map(taskCard));
    const snapshot = await Effect.runPromise(
      service.runPass({ workspaceId: "repo", repoPath: repo }),
    );

    expect(logs).toEqual([]);
    expect(resultsByTask(snapshot)).toEqual({
      "t-rebase": "merged",
      "t-forward": "merged",
    });
  }, 30_000);

  test("keeps the last result and shows a failure when the fetch fails", async () => {
    await createRepository();
    run(repo, "checkout", "-b", "odt/t-open", "origin/main");
    await commitFile(repo, "t-open.txt", "open\n");
    run(repo, "checkout", "main");
    const { service, logs } = createService([taskCard("t-open")]);
    const first = await Effect.runPromise(service.runPass({ workspaceId: "repo", repoPath: repo }));
    expect(first.tasks[0]?.result.kind).toBe("not_merged");

    run(repo, "remote", "set-url", "origin", path.join(root, "missing.git"));
    // A scheduled pass reuses the fetch of the first pass, so Check again forces a new one.
    const scheduled = await Effect.runPromise(
      service.runPass({ workspaceId: "repo", repoPath: repo }),
    );
    expect(scheduled.tasks[0]?.failure).toBeUndefined();
    const second = await Effect.runPromise(
      service.checkWorkspace({ workspaceId: "repo", repoPath: repo }),
    );

    expect(second.tasks[0]).toMatchObject({
      taskId: "t-open",
      result: { kind: "not_merged", unmergedCommitCount: 1 },
      failure: { message: expect.stringContaining("git fetch origin failed") },
    });
    expect(logs).toEqual([expect.stringContaining("remote origin")]);
  }, 30_000);
});
