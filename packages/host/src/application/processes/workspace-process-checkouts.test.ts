import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostPathAccessError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import {
  addGitWorktree,
  gitFixtureEnv,
  initGitRepository,
} from "../../test-support/git-repository-fixture";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createSettingsConfigTestDouble } from "../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../test-support/temp-directory";
import {
  createProcessRead,
  findCheckoutRoot,
  type ProcessCheckoutDependencies,
  readCheckoutCoverage,
} from "./workspace-process-checkouts";

const git = createGitCliAdapter({
  readEnv: () => gitFixtureEnv,
  resolveCommand: () => Effect.succeed("git"),
});

let root = "";
let repoPath = "";
let retiredPath = "";
let currentPath = "";

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "odt-process-checkouts-")));
  repoPath = join(root, "repo");
  retiredPath = join(root, "worktrees", "task-a");
  currentPath = join(root, "worktrees", "task-b");
  await mkdir(repoPath, { recursive: true });
  await mkdir(join(root, "worktrees"));
  initGitRepository(repoPath);
  addGitWorktree(repoPath, retiredPath, "odt/task-a-old");
  addGitWorktree(repoPath, currentPath, "odt/task-b-new");
  // Task A's retired registration now leads to the worktree of task B.
  await removeTestDirectory(retiredPath);
  await symlink(currentPath, retiredPath, "junction");
});

afterAll(async () => {
  await removeTestDirectory(root);
});

const workspace = (workspaceId: string, path: string): WorkspaceRecord => ({
  workspaceId,
  workspaceName: workspaceId,
  abbreviation: null,
  tileColor: null,
  repoPath: path,
  isActive: false,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
});

/** Like the settings adapter: a missing path is false, and any other failure stays a failure. */
const pathExists = (path: string) =>
  Effect.tryPromise({
    try: () => access(path).then(() => true),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) =>
      cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        ? Effect.succeed(false)
        : Effect.fail(
            new HostPathAccessError({ path, operation: "test.pathExists", message: String(cause) }),
          ),
    ),
  );

type CoverageOptions = {
  slowWorkspaceId?: string;
  taskADirectories?: string[];
  sessionDirectory?: string | null;
  git?: GitPort;
};

const coverageOf = (
  workspaces: WorkspaceRecord[],
  {
    slowWorkspaceId,
    taskADirectories = [],
    sessionDirectory = null,
    git: port = git,
  }: CoverageOptions = {},
) => {
  const dependencies: ProcessCheckoutDependencies = {
    git: {
      ...port,
      canonicalizePath: (path) =>
        path === workspaces.find((entry) => entry.workspaceId === slowWorkspaceId)?.repoPath
          ? Effect.sleep("100 millis").pipe(Effect.andThen(port.canonicalizePath(path)))
          : port.canonicalizePath(path),
    },
    settingsConfig: createSettingsConfigTestDouble({
      readConfig: () =>
        Effect.succeed({
          ...createDefaultGlobalConfig(),
          workspaces: Object.fromEntries(
            workspaces.map((entry) => [
              entry.workspaceId,
              repoConfigFixture({
                workspaceId: entry.workspaceId,
                repoPath,
                branchPrefix: "odt",
              }),
            ]),
          ),
        }),
      resolveConfiguredPath: (path: string) => path,
      defaultWorktreeBasePath: () => join(root, "unused"),
      join: (...paths: string[]) => join(...paths),
      pathExists,
    }),
    taskOwnership: {
      listTaskDirectoriesForWorktreeOwnership: () =>
        Effect.succeed(
          workspaces.flatMap((entry) => [
            {
              workspaceId: entry.workspaceId,
              taskId: "task-a",
              title: "Task A",
              sessionDirectories: taskADirectories,
            },
            {
              workspaceId: entry.workspaceId,
              taskId: "task-b",
              title: "Task B",
              sessionDirectories: [],
            },
          ]),
        ),
    },
    workspaceSessions: {
      listForWorktreeOwnership: () =>
        Effect.succeed(
          sessionDirectory === null
            ? []
            : workspaces.map((entry) => ({
                workspaceId: entry.workspaceId,
                id: "session-1",
                runtimeKind: "codex" as const,
                externalSessionId: null,
                workingDirectory: sessionDirectory,
                generatedTitle: null,
                manualTitle: "Main checkout chat",
                archivedAt: null,
              })),
        ),
    },
    pathPlatform: "posix",
  };
  return Effect.runPromise(
    readCheckoutCoverage(
      dependencies,
      workspaces,
      createProcessRead(dependencies, crypto.randomUUID()),
    ),
  );
};

test("never gives a task the worktree that its stale registration now leads to", async () => {
  const result = await coverageOf([workspace("repo", repoPath)]);
  const worktree = result.checkouts.find((checkout) => checkout.checkoutPath === currentPath);
  expect(worktree?.owners.map((owner) => owner.title)).toEqual(["Task B"]);
});

test("keeps catalog order for a shared checkout when a later read finishes first", async () => {
  const result = await coverageOf(
    [workspace("first", join(repoPath, ".")), workspace("second", repoPath)],
    { slowWorkspaceId: "first" },
  );
  expect(result.checkouts.find((checkout) => checkout.kind === "repository")?.workspaceId).toBe(
    "first",
  );
});

test("uses a registration branch only when its checkout has that branch now", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-moved-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    const taskB = join(base, "task-b");
    const movedB = join(base, "moved-b");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "odt/task-a-old");
    addGitWorktree(repo, taskB, "odt/task-b-new");
    // Task B's worktree moves without Git, and task A's retired path now leads to it.
    await rename(taskB, movedB);
    await removeTestDirectory(taskA);
    await symlink(movedB, taskA, "junction");

    const result = await coverageOf([workspace("repo", repo)]);
    expect(result.checkouts.filter((checkout) => checkout.kind === "worktree")).toEqual([]);
  } finally {
    await removeTestDirectory(base);
  }
});

test.skipIf(process.platform === "win32")(
  "reports a linked worktree whose path the host cannot read",
  async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-denied-")));
    const locked = join(base, "locked");
    try {
      const repo = join(base, "repo");
      await mkdir(repo);
      await mkdir(locked);
      initGitRepository(repo);
      addGitWorktree(repo, join(locked, "task-a"), "odt/task-a-feature");
      await chmod(locked, 0o000);

      const result = await coverageOf([workspace("repo", repo)]);
      expect(result.issues.map((issue) => issue.message)).toEqual([
        expect.stringContaining(`OpenDucktor cannot read ${join(locked, "task-a")}`),
      ]);
    } finally {
      await chmod(locked, 0o755);
      await removeTestDirectory(base);
    }
  },
);

test("never links a saved task path through a worktree that moved outside Git", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-saved-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    const taskB = join(base, "task-b");
    const movedB = join(base, "moved-b");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "detached-a");
    addGitWorktree(repo, taskB, "detached-b");
    // B moves without Git, so its record still names task-b. Task A's saved path leads to it.
    await rename(taskB, movedB);
    await removeTestDirectory(taskA);
    await symlink(movedB, taskA, "junction");

    const result = await coverageOf([workspace("repo", repo)], { taskADirectories: [taskA] });
    expect(result.checkouts.filter((checkout) => checkout.kind === "worktree")).toEqual([]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("covers the main checkout that a session uses from a workspace on a linked worktree", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-main-")));
  try {
    const main = join(base, "main");
    const linked = join(base, "linked");
    await mkdir(main);
    initGitRepository(main);
    addGitWorktree(main, linked, "feature");

    const result = await coverageOf([workspace("linked", linked)], { sessionDirectory: main });
    const covered = result.checkouts.find((checkout) => checkout.checkoutPath === main);
    expect(covered?.owners.map((owner) => owner.title)).toEqual(["Main checkout chat"]);
    expect(result.issues).toEqual([]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("reads each workspace with one checkout read and one worktree list", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-reads-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "odt/task-a-feature");
    addGitWorktree(repo, join(base, "task-b"), "odt/task-b-feature");
    await mkdir(join(taskA, "packages", "web"), { recursive: true });
    const calls: string[] = [];
    const counted: GitPort = {
      ...git,
      readCheckout: (...args) => {
        calls.push("readCheckout");
        return git.readCheckout(...args);
      },
      listWorktrees: (...args) => {
        calls.push("listWorktrees");
        return git.listWorktrees(...args);
      },
      getCurrentBranch: (...args) => {
        calls.push("getCurrentBranch");
        return git.getCurrentBranch(...args);
      },
    };

    const result = await coverageOf([workspace("repo", repo)], {
      taskADirectories: [join(taskA, "packages", "web")],
      git: counted,
    });
    expect(calls.sort()).toEqual(["listWorktrees", "readCheckout"]);
    expect(
      result.checkouts.map((checkout) => [
        checkout.checkoutPath,
        checkout.owners.map((owner) => owner.title),
      ]),
    ).toEqual([
      [repo, []],
      [taskA, ["Task A"]],
      [join(base, "task-b"), ["Task B"]],
    ]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("confirms a worktree whose Git files use relative paths", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-relative-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "odt/task-a-feature");
    const administration = join(repo, ".git", "worktrees", "task-a");
    await writeFile(join(taskA, ".git"), "gitdir: ../repo/.git/worktrees/task-a\n");
    await writeFile(join(administration, "gitdir"), "../../../../task-a/.git\n");

    const result = await coverageOf([workspace("repo", repo)]);
    expect(result.checkouts.map((checkout) => checkout.checkoutPath)).toEqual([repo, taskA]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("never confirms a worktree whose administrative folder Git does not list", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-copied-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    const copy = join(base, "copied-administration");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "odt/task-a-feature");
    // The copy names the shared Git directory and this path, but Git lists only `worktrees`.
    await cp(join(repo, ".git", "worktrees", "task-a"), copy, { recursive: true });
    await writeFile(join(copy, "commondir"), join(repo, ".git"));
    await writeFile(join(taskA, ".git"), `gitdir: ${copy}\n`);

    const result = await coverageOf([workspace("repo", repo)]);
    expect(result.checkouts.map((checkout) => checkout.checkoutPath)).toEqual([repo]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(`Git does not confirm ${taskA}`),
      }),
    ]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("reports the cause when the Git files of a worktree are unreadable", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "odt-process-gitfile-")));
  try {
    const repo = join(base, "repo");
    const taskA = join(base, "task-a");
    await mkdir(repo);
    initGitRepository(repo);
    addGitWorktree(repo, taskA, "odt/task-a-feature");
    await writeFile(join(taskA, ".git"), "not a Git file\n");

    const result = await coverageOf([workspace("repo", repo)]);
    expect(result.checkouts.map((checkout) => checkout.checkoutPath)).toEqual([repo]);
    expect(result.issues).toEqual([
      {
        message: expect.stringContaining(
          `OpenDucktor cannot read the Git files of ${taskA}, so its processes are hidden. ${join(taskA, ".git")} is not a valid Git file.`,
        ),
        nextAction:
          "Check that this account can read the worktree and that `git status` works in it, then refresh.",
      },
    ]);
  } finally {
    await removeTestDirectory(base);
  }
});

test("skips a workspace whose repository folder no longer exists", async () => {
  const result = await coverageOf([
    workspace("gone", join(root, "removed-repository")),
    workspace("repo", repoPath),
  ]);
  expect(result.issues).toEqual([]);
  expect(result.checkouts.some((checkout) => checkout.workspaceId === "gone")).toBe(false);
  expect(result.checkouts.some((checkout) => checkout.workspaceId === "repo")).toBe(true);
});

test("finds the deepest listed root of a key by its parent folders", () => {
  const checkout = (key: string) => ({
    workspaceId: "repo",
    workspaceName: "Repo",
    checkoutPath: key,
    key,
    kind: "repository" as const,
    owners: [],
  });
  const repo = { key: "/repo", checkout: checkout("/repo") };
  const nested = { key: "/repo/vendor/lib", checkout: null };
  const drive = { key: "C:/work", checkout: checkout("C:/work") };
  const coverage = { checkouts: [], issues: [], roots: [repo, nested, drive] };
  expect(findCheckoutRoot(coverage, "/repo/apps/web")).toBe(repo);
  expect(findCheckoutRoot(coverage, "/repo")).toBe(repo);
  expect(findCheckoutRoot(coverage, "/repo/vendor/lib/src")).toBe(nested);
  expect(findCheckoutRoot(coverage, "/repository")).toBeNull();
  expect(findCheckoutRoot(coverage, "/")).toBeNull();
  expect(findCheckoutRoot(coverage, "C:/work/apps")).toBe(drive);
  expect(findCheckoutRoot(coverage, "C:/other")).toBeNull();
});
