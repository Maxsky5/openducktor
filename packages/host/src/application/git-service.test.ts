import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllResult,
  GitConflictAbortResult,
  GitCurrentBranch,
  GitFetchRemoteResult,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitResetWorktreeSelectionResult,
  GlobalConfig,
} from "@openducktor/contracts";
import { globalConfigSchema } from "@openducktor/contracts";
import type {
  GitPort,
  GitPushBranchOptions,
  GitRemote,
  GitWorktreeStatusData,
  GitWorktreeStatusSummaryData,
} from "../ports/git-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";
import { createGitService } from "./git-service";

type FakeGitPortInput = {
  canonicalPaths?: Record<string, string>;
  gitRepositories?: string[];
  sharedCommonDirectories?: string[];
  branches?: Record<string, GitBranch[]>;
  currentBranches?: Record<string, GitCurrentBranch>;
  remotes?: Record<string, GitRemote[]>;
  statuses?: Record<string, FileStatus[]>;
  diffs?: Record<string, FileDiff[]>;
  worktreeStatuses?: Record<string, GitWorktreeStatusData>;
  worktreeStatusSummaries?: Record<string, GitWorktreeStatusSummaryData>;
  switchedBranches?: Record<string, GitCurrentBranch>;
  aheadBehind?: Record<string, CommitsAheadBehind>;
  fetchResults?: Record<string, GitFetchRemoteResult>;
  pullResults?: Record<string, GitPullBranchResult>;
  commitResults?: Record<string, GitCommitAllResult>;
  pushResults?: Record<string, GitPushBranchResult>;
  rebaseBranchResults?: Record<string, GitRebaseBranchResult>;
  rebaseAbortResults?: Record<string, GitRebaseAbortResult>;
  conflictAbortResults?: Record<string, GitConflictAbortResult>;
  resetWorktreeSelectionResults?: Record<string, GitResetWorktreeSelectionResult>;
  calls?: string[];
  removeWorktreeErrors?: Record<string, Error>;
  ancestorResults?: Record<string, boolean>;
};

const createFakeGitPort = ({
  canonicalPaths = {},
  gitRepositories = [],
  sharedCommonDirectories = [],
  branches = {},
  currentBranches = {},
  remotes = {},
  statuses = {},
  diffs = {},
  worktreeStatuses = {},
  worktreeStatusSummaries = {},
  switchedBranches = {},
  aheadBehind = {},
  fetchResults = {},
  pullResults = {},
  commitResults = {},
  pushResults = {},
  rebaseBranchResults = {},
  rebaseAbortResults = {},
  conflictAbortResults = {},
  resetWorktreeSelectionResults = {},
  calls = [],
  removeWorktreeErrors = {},
  ancestorResults = {},
}: FakeGitPortInput = {}): GitPort => ({
  async canonicalizePath(path) {
    const canonicalPath = canonicalPaths[path];
    if (!canonicalPath) {
      throw new Error(`missing path fixture: ${path}`);
    }

    return canonicalPath;
  },
  async isGitRepository(path) {
    return gitRepositories.includes(path);
  },
  async shareGitCommonDirectory(repoPath, workingDir) {
    return sharedCommonDirectories.includes(`${repoPath}|${workingDir}`);
  },
  async listRemotes(workingDir) {
    return remotes[workingDir] ?? [];
  },
  async listBranches(workingDir) {
    return branches[workingDir] ?? [];
  },
  async getCurrentBranch(workingDir) {
    return currentBranches[workingDir] ?? { detached: true };
  },
  async getStatus(workingDir) {
    return statuses[workingDir] ?? [];
  },
  async getDiff(workingDir, targetBranch) {
    return diffs[`${workingDir}|${targetBranch ?? ""}`] ?? [];
  },
  async getWorktreeStatusData(workingDir, targetBranch, diffScope) {
    return (
      worktreeStatuses[`${workingDir}|${targetBranch}|${diffScope}`] ?? {
        currentBranch: { detached: true },
        fileStatuses: [],
        fileDiffs: [],
        targetAheadBehind: { ahead: 0, behind: 0 },
        upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
      }
    );
  },
  async getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
    return (
      worktreeStatusSummaries[`${workingDir}|${targetBranch}|${diffScope}`] ?? {
        currentBranch: { detached: true },
        fileStatuses: [],
        fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
        targetAheadBehind: { ahead: 0, behind: 0 },
        upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
      }
    );
  },
  async switchBranch(workingDir, branch, create) {
    return (
      switchedBranches[`${workingDir}|${branch}|${String(create)}`] ?? {
        name: branch,
        detached: false,
      }
    );
  },
  async createWorktree(repoPath, worktreePath, branch, createBranch) {
    calls.push(`createWorktree:${repoPath}|${worktreePath}|${branch}|${String(createBranch)}`);
  },
  async removeWorktree(repoPath, worktreePath, force) {
    calls.push(`removeWorktree:${repoPath}|${worktreePath}|${String(force)}`);
    const error = removeWorktreeErrors[`${repoPath}|${worktreePath}|${String(force)}`];
    if (error) {
      throw error;
    }
  },
  async deleteLocalBranch(repoPath, branch, force) {
    calls.push(`deleteLocalBranch:${repoPath}|${branch}|${String(force)}`);
  },
  async isAncestor(workingDir, ancestor, descendant) {
    return ancestorResults[`${workingDir}|${ancestor}|${descendant}`] ?? true;
  },
  async suggestedSquashCommitMessage() {
    return undefined;
  },
  async resetWorktreeSelection(workingDir, _fileDiffs, selection) {
    const key = `${workingDir}|${selection.kind}|${selection.filePath}`;
    return resetWorktreeSelectionResults[key] ?? { affectedPaths: [selection.filePath] };
  },
  async commitsAheadBehind(workingDir, targetBranch) {
    return aheadBehind[`${workingDir}|${targetBranch}`] ?? { ahead: 0, behind: 0 };
  },
  async fetchRemote(workingDir, targetBranch) {
    return (
      fetchResults[`${workingDir}|${targetBranch}`] ?? {
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      }
    );
  },
  async pullBranch(workingDir) {
    return (
      pullResults[workingDir] ?? { outcome: "up_to_date", output: "No upstream commits to pull" }
    );
  },
  async commitAll(workingDir, message) {
    return (
      commitResults[`${workingDir}|${message}`] ?? {
        outcome: "no_changes",
        output: "No staged changes to commit",
      }
    );
  },
  async pushBranch(workingDir, branch, options?: GitPushBranchOptions) {
    const key = `${workingDir}|${branch}|${options?.remote ?? ""}|${String(
      options?.setUpstream,
    )}|${String(options?.forceWithLease)}`;
    return (
      pushResults[key] ?? {
        outcome: "pushed",
        remote: options?.remote ?? "origin",
        branch,
        output: "Pushed",
      }
    );
  },
  async rebaseBranch(workingDir, targetBranch) {
    return (
      rebaseBranchResults[`${workingDir}|${targetBranch}`] ?? {
        outcome: "rebased",
        output: "Successfully rebased",
      }
    );
  },
  async rebaseAbort(workingDir) {
    return (
      rebaseAbortResults[workingDir] ?? {
        outcome: "aborted",
        output: "Successfully aborted rebase",
      }
    );
  },
  async abortConflict(workingDir, operation) {
    return (
      conflictAbortResults[`${workingDir}|${operation}`] ?? {
        output: "Conflict operation aborted",
      }
    );
  },
});

const createFakeSettingsConfig = (config: GlobalConfig): SettingsConfigPort => ({
  async readConfig() {
    return config;
  },
  async writeConfig() {},
  defaultWorktreeBasePath(workspaceId) {
    return `/managed/${workspaceId}`;
  },
  defaultRepoWorktreeBasePath(repoPath) {
    return `/managed/${repoPath.split("/").at(-1) ?? "repo"}-legacy`;
  },
  resolveConfiguredPath(rawPath) {
    return rawPath === "~/worktrees" ? "/home/user/worktrees" : rawPath;
  },
  async canonicalizePath(path) {
    return path;
  },
  async pathExists() {
    return true;
  },
  join(...paths) {
    return paths.join("/");
  },
});

const createFakeWorktreeFiles = (calls: string[] = []): WorktreeFilePort => ({
  async copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
    calls.push(`copyConfiguredPaths:${repoPath}|${worktreePath}|${relativePaths.join(",")}`);
  },
  async removePathIfPresent(path) {
    calls.push(`removePathIfPresent:${path}`);
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
  },
  async pathIsWithinRoot(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}/`);
  },
});

const createConfig = (): GlobalConfig =>
  globalConfigSchema.parse({
    version: 2,
    workspaces: {
      repo: {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/canonical/repo",
        defaultRuntimeKind: "codex",
        worktreeCopyPaths: [".env"],
      },
    },
  });

describe("createGitService", () => {
  test("returns branches from the canonical repository path", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        branches: {
          "/canonical/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "origin/main", isCurrent: false, isRemote: true },
          ],
        },
      }),
    );

    await expect(service.getBranches({ repoPath: "/repo" })).resolves.toEqual([
      { name: "main", isCurrent: true, isRemote: false },
      { name: "origin/main", isCurrent: false, isRemote: true },
    ]);
  });

  test("uses an authorized linked worktree for current branch reads", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        currentBranches: {
          "/canonical/worktree": {
            name: "feature/electron",
            detached: false,
            revision: "abc123",
          },
        },
      }),
    );

    await expect(
      service.getCurrentBranch({ repoPath: "/repo", workingDir: "/worktree" }),
    ).resolves.toEqual({
      name: "feature/electron",
      detached: false,
      revision: "abc123",
    });
  });

  test("returns file statuses from the canonical repository path", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        statuses: {
          "/canonical/repo": [
            { path: "src/main.ts", status: "modified", staged: false },
            { path: "src/new.ts", status: "added", staged: true },
          ],
        },
      }),
    );

    await expect(service.getStatus({ repoPath: "/repo" })).resolves.toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
      { path: "src/new.ts", status: "added", staged: true },
    ]);
  });

  test("rejects a working directory outside the authorized repository", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/outside": "/canonical/outside",
        },
        gitRepositories: ["/canonical/repo", "/canonical/outside"],
      }),
    );

    await expect(service.getStatus({ repoPath: "/repo", workingDir: "/outside" })).rejects.toThrow(
      "working_dir is not within authorized repository or linked worktrees: /outside",
    );
  });

  test("returns commits ahead and behind from an authorized worktree", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        aheadBehind: {
          "/canonical/worktree|origin/main": { ahead: 3, behind: 2 },
        },
      }),
    );

    await expect(
      service.commitsAheadBehind({
        repoPath: "/repo",
        targetBranch: "origin/main",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({ ahead: 3, behind: 2 });
  });

  test("switches a repository branch with trimmed branch name and default create flag", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        switchedBranches: {
          "/canonical/repo|feature/electron|false": {
            name: "feature/electron",
            detached: false,
            revision: "abc123",
          },
        },
      }),
    );

    await expect(
      service.switchBranch({
        repoPath: "/repo",
        branch: "  feature/electron  ",
      }),
    ).resolves.toEqual({
      name: "feature/electron",
      detached: false,
      revision: "abc123",
    });
  });

  test("forwards switch branch create flag", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        switchedBranches: {
          "/canonical/repo|feature/new|true": {
            name: "feature/new",
            detached: false,
          },
        },
      }),
    );

    await expect(
      service.switchBranch({
        repoPath: "/repo",
        branch: "feature/new",
        create: true,
      }),
    ).resolves.toEqual({
      name: "feature/new",
      detached: false,
    });
  });

  test("fetches remotes from an authorized worktree and trims target branch", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        fetchResults: {
          "/canonical/worktree|origin/main": {
            outcome: "fetched",
            output: "Fetched origin",
          },
        },
      }),
    );

    await expect(
      service.fetchRemote({
        repoPath: "/repo",
        targetBranch: "  origin/main  ",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "fetched",
      output: "Fetched origin",
    });
  });

  test("pulls an authorized worktree branch", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        pullResults: {
          "/canonical/worktree": {
            outcome: "pulled",
            output: "Fast-forward",
          },
        },
      }),
    );

    await expect(
      service.pullBranch({
        repoPath: "/repo",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "pulled",
      output: "Fast-forward",
    });
  });

  test("commits all changes in an authorized worktree and trims the message", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        commitResults: {
          "/canonical/worktree|Ship Electron host": {
            outcome: "committed",
            commitHash: "abc123",
            output: "[feature abc123] Ship Electron host",
          },
        },
      }),
    );

    await expect(
      service.commitAll({
        repoPath: "/repo",
        message: "  Ship Electron host  ",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
  });

  test("pushes an authorized worktree branch with defaulted remote and boolean flags", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        pushResults: {
          "/canonical/worktree|feature/electron|origin|true|false": {
            outcome: "pushed",
            remote: "origin",
            branch: "feature/electron",
            output: "Pushed",
          },
        },
      }),
    );

    await expect(
      service.pushBranch({
        repoPath: "/repo",
        branch: "  feature/electron  ",
        remote: "   ",
        setUpstream: true,
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "Pushed",
    });
  });

  test("rebases an authorized worktree branch and preserves conflict results", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        rebaseBranchResults: {
          "/canonical/worktree|origin/main": {
            outcome: "conflicts",
            conflictedFiles: ["src/main.ts"],
            output: "CONFLICT (content): Merge conflict in src/main.ts",
          },
        },
      }),
    );

    await expect(
      service.rebaseBranch({
        repoPath: "/repo",
        targetBranch: "  origin/main  ",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    });
  });

  test("aborts rebase and conflict operations from an authorized worktree", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        rebaseAbortResults: {
          "/canonical/worktree": {
            outcome: "aborted",
            output: "rebase aborted",
          },
        },
        conflictAbortResults: {
          "/canonical/worktree|direct_merge_squash": {
            output: "HEAD is now at abc123 feature",
          },
        },
      }),
    );

    await expect(
      service.rebaseAbort({
        repoPath: "/repo",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "aborted",
      output: "rebase aborted",
    });
    await expect(
      service.abortConflict({
        repoPath: "/repo",
        operation: "direct_merge_squash",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      output: "HEAD is now at abc123 feature",
    });
  });

  test("creates a worktree and copies configured paths", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      settingsConfig: createFakeSettingsConfig(createConfig()),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });

    await expect(
      service.createWorktree({
        repoPath: "/repo",
        worktreePath: "/worktrees/repo-task",
        branch: "feature/task",
        createBranch: true,
      }),
    ).resolves.toEqual({
      branch: "feature/task",
      worktreePath: "/worktrees/repo-task",
    });
    expect(calls).toEqual([
      "createWorktree:/canonical/repo|/worktrees/repo-task|feature/task|true",
      "copyConfiguredPaths:/canonical/repo|/worktrees/repo-task|.env",
    ]);
  });

  test("removes a worktree and cleans up the filesystem path", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      settingsConfig: createFakeSettingsConfig(createConfig()),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });

    await expect(
      service.removeWorktree({
        repoPath: "/repo",
        worktreePath: "/managed/repo/task-1",
        force: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "removeWorktree:/canonical/repo|/managed/repo/task-1|true",
      "removePathIfPresent:/managed/repo/task-1",
    ]);
  });

  test("rejects forced stranded worktree cleanup outside managed roots", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
        removeWorktreeErrors: {
          "/canonical/repo|/outside/task-1|true": new Error("fatal: is not a working tree"),
        },
      }),
      settingsConfig: createFakeSettingsConfig(createConfig()),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });

    await expect(
      service.removeWorktree({
        repoPath: "/repo",
        worktreePath: "/outside/task-1",
        force: true,
      }),
    ).rejects.toThrow("outside managed roots");
    expect(calls).toEqual(["removeWorktree:/canonical/repo|/outside/task-1|true"]);
  });

  test("resets a worktree selection after validating the current snapshot", async () => {
    const statusData: GitWorktreeStatusData = {
      currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
      fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
      fileDiffs: [
        {
          file: "src/main.ts",
          type: "modified",
          additions: 1,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new\n",
        },
      ],
      targetAheadBehind: { ahead: 2, behind: 1 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
    };
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        worktreeStatuses: {
          "/canonical/worktree|origin/main|uncommitted": statusData,
        },
        resetWorktreeSelectionResults: {
          "/canonical/worktree|hunk|src/main.ts": {
            affectedPaths: ["src/main.ts"],
          },
        },
      }),
    );
    const current = await service.getWorktreeStatus({
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "uncommitted",
      workingDir: "/worktree",
    });

    await expect(
      service.resetWorktreeSelection({
        repoPath: "/repo",
        targetBranch: "  origin/main  ",
        workingDir: "/worktree",
        snapshot: {
          hashVersion: current.snapshot.hashVersion,
          statusHash: current.snapshot.statusHash,
          diffHash: current.snapshot.diffHash,
        },
        selection: {
          kind: "hunk",
          filePath: "src/main.ts",
          hunkIndex: 0,
        },
      }),
    ).resolves.toEqual({
      affectedPaths: ["src/main.ts"],
    });
  });

  test("rejects stale worktree reset snapshots before mutating git", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        worktreeStatuses: {
          "/canonical/repo|origin/main|uncommitted": {
            currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
            fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
            fileDiffs: [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          },
        },
      }),
    );

    await expect(
      service.resetWorktreeSelection({
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "0000000000000000",
          diffHash: "0000000000000000",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).rejects.toThrow("Displayed diff is stale. Refresh and try again.");
  });

  test("returns file diffs from an authorized worktree", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        diffs: {
          "/canonical/worktree|origin/main": [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 2,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-old\n+new\n",
            },
          ],
        },
      }),
    );

    await expect(
      service.getDiff({
        repoPath: "/repo",
        targetBranch: "origin/main",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]);
  });

  test("returns worktree status snapshots from an authorized worktree", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: {
          "/repo": "/canonical/repo",
          "/worktree": "/canonical/worktree",
        },
        gitRepositories: ["/canonical/repo", "/canonical/worktree"],
        sharedCommonDirectories: ["/canonical/repo|/canonical/worktree"],
        worktreeStatuses: {
          "/canonical/worktree|origin/main|target": {
            currentBranch: {
              name: "feature/electron",
              detached: false,
              revision: "abc123",
            },
            fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
            fileDiffs: [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 2,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 3, behind: 0 },
            gitConflict: {
              operation: "rebase",
              currentBranch: "feature/electron",
              targetBranch: "origin/main",
              conflictedFiles: ["src/main.ts"],
              output: "rebase conflict",
            },
          },
        },
      }),
    );

    const status = await service.getWorktreeStatus({
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "target",
      workingDir: "/worktree",
    });

    expect(status.currentBranch.name).toBe("feature/electron");
    expect(status.gitConflict?.workingDir).toBe("/canonical/worktree");
    expect(status.snapshot).toMatchObject({
      effectiveWorkingDir: "/canonical/worktree",
      targetBranch: "origin/main",
      diffScope: "target",
      hashVersion: 1,
    });
    expect(status.snapshot.statusHash).toMatch(/^[0-9a-f]{16}$/);
    expect(status.snapshot.diffHash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("returns worktree status summaries with validated diff scope", async () => {
    const service = createGitService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        worktreeStatusSummaries: {
          "/canonical/repo|origin/main|uncommitted": {
            currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
            fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
            fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
          },
        },
      }),
    );

    const summary = await service.getWorktreeStatusSummary({
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "uncommitted",
    });

    expect(summary.fileStatusCounts).toEqual({ total: 1, staged: 0, unstaged: 1 });
    expect(summary.snapshot.diffScope).toBe("uncommitted");
  });

  test("rejects invalid worktree status diff scopes before calling git", async () => {
    const service = createGitService(createFakeGitPort());

    await expect(
      service.getWorktreeStatus({
        repoPath: "/repo",
        targetBranch: "origin/main",
        diffScope: "all",
      }),
    ).rejects.toThrow("diffScope must be either 'target' or 'uncommitted', got: all");
  });

  test("rejects empty target branches before calling git", async () => {
    const service = createGitService(createFakeGitPort());

    await expect(
      service.commitsAheadBehind({ repoPath: "/repo", targetBranch: " " }),
    ).rejects.toThrow("targetBranch is required.");
  });
});
