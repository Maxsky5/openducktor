import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort, GitRemote } from "../../ports/git-port";
import {
  createGithubRepositoryDetectionService as createEffectGithubRepositoryDetectionService,
  parseGithubRemoteUrl,
} from "./github-repository-detection-service";

const createGithubRepositoryDetectionService = (
  ...args: Parameters<typeof createEffectGithubRepositoryDetectionService>
) => createEffectGithubRepositoryDetectionService(...args);
type FakeGitPortInput = {
  canonicalPaths?: Record<string, string>;
  gitRepositories?: string[];
  remotes?: Record<string, GitRemote[]>;
};
const createFakeGitPort = ({
  canonicalPaths = {},
  gitRepositories = [],
  remotes = {},
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
    getRepositoryRoot(path) {
      return Effect.succeed(path);
    },
    shareGitCommonDirectory() {
      return Effect.tryPromise({
        try: async () => {
          return true;
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
    listBranches() {
      return Effect.tryPromise({
        try: async () => {
          return [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    listFiles() {
      return Effect.succeed([]);
    },
    getCurrentBranch() {
      return Effect.tryPromise({
        try: async () => {
          return { detached: true };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getStatus() {
      return Effect.tryPromise({
        try: async () => {
          return [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    listChangedFiles() {
      return Effect.succeed([]);
    },
    getDiff() {
      return Effect.tryPromise({
        try: async () => {
          return [];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getWorktreeStatusData() {
      return Effect.tryPromise({
        try: async () => {
          return {
            currentBranch: { detached: true },
            fileStatuses: [],
            fileDiffs: [],
            targetAheadBehind: { ahead: 0, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
          };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getWorktreeStatusSummaryData() {
      return Effect.tryPromise({
        try: async () => {
          return {
            currentBranch: { detached: true },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 0, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
          };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    commitsAheadBehind() {
      return Effect.tryPromise({
        try: async () => {
          return { ahead: 0, behind: 0 };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isAncestor() {
      return Effect.tryPromise({
        try: async () => {
          return true;
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
    createWorktree() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected create worktree");
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
    removeWorktree() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected remove worktree");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    deleteLocalBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected delete local branch");
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
    switchBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected switch branch");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    resetWorktreeSelection() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected reset");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    fetchRemote() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected fetch");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    pullBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected pull");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    commitAll() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected commit");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    pushBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected push");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    rebaseBranch() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected rebase");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    rebaseAbort() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected rebase abort");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    abortConflict() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected conflict abort");
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
describe("parseGithubRemoteUrl", () => {
  test("parses supported GitHub remote URL forms", () => {
    expect(parseGithubRemoteUrl("https://token@github.com/owner/repo.git")).toEqual({
      host: "github.com",
      owner: "owner",
      name: "repo",
    });
    expect(parseGithubRemoteUrl("git@github.com:owner/repo.git")).toEqual({
      host: "github.com",
      owner: "owner",
      name: "repo",
    });
    expect(parseGithubRemoteUrl("ssh://git@github.mycorp.com/owner/repo.git")).toEqual({
      host: "github.mycorp.com",
      owner: "owner",
      name: "repo",
    });
  });
});
describe("createGithubRepositoryDetectionService", () => {
  test("returns the single unique repository detected from remotes", async () => {
    const service = createGithubRepositoryDetectionService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        remotes: {
          "/canonical/repo": [
            { name: "origin", url: "git@github.com:openai/openducktor.git" },
            { name: "backup", url: "https://github.com/openai/openducktor.git" },
          ],
        },
      }),
    );
    await expect(
      Effect.runPromise(service.detectGithubRepository({ repoPath: "/repo" })),
    ).resolves.toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });
  test("returns null when multiple unique repositories are detected", async () => {
    const service = createGithubRepositoryDetectionService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
        gitRepositories: ["/canonical/repo"],
        remotes: {
          "/canonical/repo": [
            { name: "origin", url: "git@github.com:openai/openducktor.git" },
            { name: "fork", url: "git@github.com:someone/openducktor.git" },
          ],
        },
      }),
    );
    await expect(
      Effect.runPromise(service.detectGithubRepository({ repoPath: "/repo" })),
    ).resolves.toBeNull();
  });
  test("rejects non-git repositories", async () => {
    const service = createGithubRepositoryDetectionService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
      }),
    );
    await expect(
      Effect.runPromise(service.detectGithubRepository({ repoPath: "/repo" })),
    ).rejects.toThrow("Not a git repository: /canonical/repo");
  });
});
