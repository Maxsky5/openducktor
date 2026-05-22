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
import { Effect } from "effect";
import {
  HostDependencyError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  GitPort,
  GitPushBranchOptions,
  GitRemote,
  GitWorktreeStatusData,
  GitWorktreeStatusSummaryData,
} from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { createGitService as createEffectGitService } from "./git-service";

const createGitService = (...args: Parameters<typeof createEffectGitService>) =>
  createEffectGitService(...args);
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
}: FakeGitPortInput = {}): GitPort =>
  ({
    canonicalizePath(path) {
      return Effect.tryPromise({
        try: async () => {
          const canonicalPath = canonicalPaths[path];
          if (!canonicalPath) {
            throw new Error(`missing path fixture: ${path}`);
          }
          return canonicalPath;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isGitRepository(path) {
      return Effect.tryPromise({
        try: async () => {
          return gitRepositories.includes(path);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    shareGitCommonDirectory(repoPath, workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return sharedCommonDirectories.includes(`${repoPath}|${workingDir}`);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    referenceExists() {
      return Effect.succeed(true);
    },
    listRemotes(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return remotes[workingDir] ?? [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    listBranches(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return branches[workingDir] ?? [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getCurrentBranch(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return currentBranches[workingDir] ?? { detached: true };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getStatus(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return statuses[workingDir] ?? [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getDiff(workingDir, targetBranch) {
      return Effect.tryPromise({
        try: async () => {
          return diffs[`${workingDir}|${targetBranch ?? ""}`] ?? [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getWorktreeStatusData(workingDir, targetBranch, diffScope) {
      return Effect.tryPromise({
        try: async () => {
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
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
      return Effect.tryPromise({
        try: async () => {
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
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    switchBranch(workingDir, branch, create) {
      return Effect.tryPromise({
        try: async () => {
          return (
            switchedBranches[`${workingDir}|${branch}|${String(create)}`] ?? {
              name: branch,
              detached: false,
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    createWorktree(repoPath, worktreePath, branch, createBranch) {
      return Effect.tryPromise({
        try: async () => {
          calls.push(
            `createWorktree:${repoPath}|${worktreePath}|${branch}|${String(createBranch)}`,
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    configureBranchUpstream() {
      return Effect.succeed({ createdTrackingRef: null });
    },
    deleteReference() {
      return Effect.void;
    },
    removeWorktree(repoPath, worktreePath, force) {
      return Effect.tryPromise({
        try: async () => {
          calls.push(`removeWorktree:${repoPath}|${worktreePath}|${String(force)}`);
          const error = removeWorktreeErrors[`${repoPath}|${worktreePath}|${String(force)}`];
          if (error) {
            throw error;
          }
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    deleteLocalBranch(repoPath, branch, force) {
      return Effect.tryPromise({
        try: async () => {
          calls.push(`deleteLocalBranch:${repoPath}|${branch}|${String(force)}`);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isAncestor(workingDir, ancestor, descendant) {
      return Effect.tryPromise({
        try: async () => {
          return ancestorResults[`${workingDir}|${ancestor}|${descendant}`] ?? true;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    suggestedSquashCommitMessage() {
      return Effect.tryPromise({
        try: async () => {
          return undefined;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    mergeBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected merge branch");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    resetWorktreeSelection(workingDir, _fileDiffs, selection) {
      return Effect.tryPromise({
        try: async () => {
          const key = `${workingDir}|${selection.kind}|${selection.filePath}`;
          return resetWorktreeSelectionResults[key] ?? { affectedPaths: [selection.filePath] };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    commitsAheadBehind(workingDir, targetBranch) {
      return Effect.tryPromise({
        try: async () => {
          return aheadBehind[`${workingDir}|${targetBranch}`] ?? { ahead: 0, behind: 0 };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    fetchRemote(workingDir, targetBranch) {
      return Effect.tryPromise({
        try: async () => {
          return (
            fetchResults[`${workingDir}|${targetBranch}`] ?? {
              outcome: "skipped_no_remote",
              output:
                "Skipped git fetch because no applicable remote is configured for this repo or branch.",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    pullBranch(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return (
            pullResults[workingDir] ?? {
              outcome: "up_to_date",
              output: "No upstream commits to pull",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    commitAll(workingDir, message) {
      return Effect.tryPromise({
        try: async () => {
          return (
            commitResults[`${workingDir}|${message}`] ?? {
              outcome: "no_changes",
              output: "No staged changes to commit",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    pushBranch(workingDir, branch, options?: GitPushBranchOptions) {
      return Effect.tryPromise({
        try: async () => {
          const key = `${workingDir}|${branch}|${options?.remote ?? ""}|${String(options?.setUpstream)}|${String(options?.forceWithLease)}`;
          return (
            pushResults[key] ?? {
              outcome: "pushed",
              remote: options?.remote ?? "origin",
              branch,
              output: "Pushed",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    rebaseBranch(workingDir, targetBranch) {
      return Effect.tryPromise({
        try: async () => {
          return (
            rebaseBranchResults[`${workingDir}|${targetBranch}`] ?? {
              outcome: "rebased",
              output: "Successfully rebased",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    rebaseAbort(workingDir) {
      return Effect.tryPromise({
        try: async () => {
          return (
            rebaseAbortResults[workingDir] ?? {
              outcome: "aborted",
              output: "Successfully aborted rebase",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    abortConflict(workingDir, operation) {
      return Effect.tryPromise({
        try: async () => {
          return (
            conflictAbortResults[`${workingDir}|${operation}`] ?? {
              output: "Conflict operation aborted",
            }
          );
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) as GitPort as unknown as GitPort;
const createFakeSettingsConfig = (config: GlobalConfig | null): SettingsConfigPort => ({
  readConfig() {
    return Effect.tryPromise({
      try: async () => {
        return config;
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  writeConfig() {
    return Effect.tryPromise({
      try: async () => {},
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  defaultWorktreeBasePath(workspaceId) {
    return `/managed/${workspaceId}`;
  },
  defaultRepoWorktreeBasePath(repoPath) {
    return `/managed/${repoPath.split("/").at(-1) ?? "repo"}`;
  },
  resolveConfiguredPath(rawPath) {
    return rawPath === "~/worktrees" ? "/home/user/worktrees" : rawPath;
  },
  canonicalizePath(path) {
    return Effect.tryPromise({
      try: async () => {
        return path;
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  pathExists() {
    return Effect.succeed(true);
  },
  join(...paths) {
    return paths.join("/");
  },
});
const createFakeWorktreeFiles = (calls: string[] = []): WorktreeFilePort => ({
  ensureDirectory(path) {
    return Effect.tryPromise({
      try: async () => {
        calls.push(`ensureDirectory:${path}`);
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
    return Effect.tryPromise({
      try: async () => {
        calls.push(`copyConfiguredPaths:${repoPath}|${worktreePath}|${relativePaths.join(",")}`);
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  removePathIfPresent(path) {
    return Effect.tryPromise({
      try: async () => {
        calls.push(`removePathIfPresent:${path}`);
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
  },
  pathIsWithinRoot(root, candidate) {
    return Effect.tryPromise({
      try: async () => {
        return candidate === root || candidate.startsWith(`${root}/`);
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    });
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
    await expect(Effect.runPromise(service.getBranches({ repoPath: "/repo" }))).resolves.toEqual([
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
      Effect.runPromise(service.getCurrentBranch({ repoPath: "/repo", workingDir: "/worktree" })),
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
    await expect(Effect.runPromise(service.getStatus({ repoPath: "/repo" }))).resolves.toEqual([
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
    await expect(
      Effect.runPromise(service.getStatus({ repoPath: "/repo", workingDir: "/outside" })),
    ).rejects.toThrow(
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
      Effect.runPromise(
        service.commitsAheadBehind({
          repoPath: "/repo",
          targetBranch: "origin/main",
          workingDir: "/worktree",
        }),
      ),
    ).resolves.toEqual({ ahead: 3, behind: 2 });
  });
  test("switches a repository branch", async () => {
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
      Effect.runPromise(
        service.switchBranch({
          repoPath: "/repo",
          branch: "feature/electron",
          create: false,
        }),
      ),
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
      Effect.runPromise(
        service.switchBranch({
          repoPath: "/repo",
          branch: "feature/new",
          create: true,
        }),
      ),
    ).resolves.toEqual({
      name: "feature/new",
      detached: false,
    });
  });
  test("fetches remotes from an authorized worktree", async () => {
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
      Effect.runPromise(
        service.fetchRemote({
          repoPath: "/repo",
          targetBranch: "origin/main",
          workingDir: "/worktree",
        }),
      ),
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
      Effect.runPromise(
        service.pullBranch({
          repoPath: "/repo",
          workingDir: "/worktree",
        }),
      ),
    ).resolves.toEqual({
      outcome: "pulled",
      output: "Fast-forward",
    });
  });
  test("commits all changes in an authorized worktree", async () => {
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
      Effect.runPromise(
        service.commitAll({
          repoPath: "/repo",
          message: "Ship Electron host",
          workingDir: "/worktree",
        }),
      ),
    ).resolves.toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
  });
  test("pushes an authorized worktree branch", async () => {
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
      Effect.runPromise(
        service.pushBranch({
          repoPath: "/repo",
          branch: "feature/electron",
          remote: "origin",
          setUpstream: true,
          workingDir: "/worktree",
        }),
      ),
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
      Effect.runPromise(
        service.rebaseBranch({
          repoPath: "/repo",
          targetBranch: "origin/main",
          workingDir: "/worktree",
        }),
      ),
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
      Effect.runPromise(
        service.rebaseAbort({
          repoPath: "/repo",
          workingDir: "/worktree",
        }),
      ),
    ).resolves.toEqual({
      outcome: "aborted",
      output: "rebase aborted",
    });
    await expect(
      Effect.runPromise(
        service.abortConflict({
          repoPath: "/repo",
          operation: "direct_merge_squash",
          workingDir: "/worktree",
        }),
      ),
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
      Effect.runPromise(
        service.createWorktree({
          repoPath: "/repo",
          worktreePath: "/worktrees/repo-task",
          branch: "feature/task",
          createBranch: true,
        }),
      ),
    ).resolves.toEqual({
      branch: "feature/task",
      worktreePath: "/worktrees/repo-task",
    });
    expect(calls).toEqual([
      "createWorktree:/canonical/repo|/worktrees/repo-task|feature/task|true",
      "copyConfiguredPaths:/canonical/repo|/worktrees/repo-task|.env",
    ]);
  });
  test("fails create worktree through the Effect channel when settings config is missing", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });
    const error = await Effect.runPromise(
      Effect.flip(
        service.createWorktree({
          repoPath: "/repo",
          worktreePath: "/worktrees/repo-task",
          branch: "feature/task",
          createBranch: true,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostDependencyError);
    if (!(error instanceof HostDependencyError)) {
      throw new Error("expected missing settings config to fail with HostDependencyError");
    }
    expect(error.dependency).toBe("settingsConfig");
    expect(calls).toEqual([]);
  });
  test("fails create worktree through the Effect channel when worktree files are missing", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      settingsConfig: createFakeSettingsConfig(createConfig()),
    });
    const error = await Effect.runPromise(
      Effect.flip(
        service.createWorktree({
          repoPath: "/repo",
          worktreePath: "/worktrees/repo-task",
          branch: "feature/task",
          createBranch: true,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostDependencyError);
    if (!(error instanceof HostDependencyError)) {
      throw new Error("expected missing worktree files to fail with HostDependencyError");
    }
    expect(error.dependency).toBe("worktreeFiles");
    expect(calls).toEqual([]);
  });
  test("fails create worktree through the Effect channel when workspace config is missing", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      settingsConfig: createFakeSettingsConfig(null),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });
    const error = await Effect.runPromise(
      Effect.flip(
        service.createWorktree({
          repoPath: "/repo",
          worktreePath: "/worktrees/repo-task",
          branch: "feature/task",
          createBranch: true,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostValidationError);
    expect(error.message).toBe(
      "No OpenDucktor workspace config is available for git worktree mutation.",
    );
    expect(calls).toEqual([]);
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
      Effect.runPromise(
        service.removeWorktree({
          repoPath: "/repo",
          worktreePath: "/managed/repo/task-1",
          force: true,
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "removeWorktree:/canonical/repo|/managed/repo/task-1|true",
      "removePathIfPresent:/managed/repo/task-1",
    ]);
  });
  test("fails remove worktree through the Effect channel when settings config is missing", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      worktreeFiles: createFakeWorktreeFiles(calls),
    });
    const error = await Effect.runPromise(
      Effect.flip(
        service.removeWorktree({
          repoPath: "/repo",
          worktreePath: "/managed/repo/task-1",
          force: true,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostDependencyError);
    if (!(error instanceof HostDependencyError)) {
      throw new Error("expected missing settings config to fail with HostDependencyError");
    }
    expect(error.dependency).toBe("settingsConfig");
    expect(calls).toEqual([]);
  });
  test("fails remove worktree through the Effect channel when worktree files are missing", async () => {
    const calls: string[] = [];
    const service = createGitService({
      gitPort: createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        calls,
      }),
      settingsConfig: createFakeSettingsConfig(createConfig()),
    });
    const error = await Effect.runPromise(
      Effect.flip(
        service.removeWorktree({
          repoPath: "/repo",
          worktreePath: "/managed/repo/task-1",
          force: true,
        }),
      ),
    );
    expect(error).toBeInstanceOf(HostDependencyError);
    if (!(error instanceof HostDependencyError)) {
      throw new Error("expected missing worktree files to fail with HostDependencyError");
    }
    expect(error.dependency).toBe("worktreeFiles");
    expect(calls).toEqual([]);
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
      Effect.runPromise(
        service.removeWorktree({
          repoPath: "/repo",
          worktreePath: "/outside/task-1",
          force: true,
        }),
      ),
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
    const current = await Effect.runPromise(
      service.getWorktreeStatus({
        repoPath: "/repo",
        targetBranch: "origin/main",
        diffScope: "uncommitted",
        workingDir: "/worktree",
      }),
    );
    await expect(
      Effect.runPromise(
        service.resetWorktreeSelection({
          repoPath: "/repo",
          targetBranch: "origin/main",
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
      ),
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
      Effect.runPromise(
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
      ),
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
      Effect.runPromise(
        service.getDiff({
          repoPath: "/repo",
          targetBranch: "origin/main",
          workingDir: "/worktree",
        }),
      ),
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
    const status = await Effect.runPromise(
      service.getWorktreeStatus({
        repoPath: "/repo",
        targetBranch: "origin/main",
        diffScope: "target",
        workingDir: "/worktree",
      }),
    );
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
    const summary = await Effect.runPromise(
      service.getWorktreeStatusSummary({
        repoPath: "/repo",
        targetBranch: "origin/main",
        diffScope: "uncommitted",
      }),
    );
    expect(summary.fileStatusCounts).toEqual({ total: 1, staged: 0, unstaged: 1 });
    expect(summary.snapshot.diffScope).toBe("uncommitted");
  });
});
