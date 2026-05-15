import type { GitPort, GitRemote } from "../../ports/git-port";
import {
  createGithubRepositoryDetectionService,
  parseGithubRemoteUrl,
} from "./github-repository-detection-service";

type FakeGitPortInput = {
  canonicalPaths?: Record<string, string>;
  gitRepositories?: string[];
  remotes?: Record<string, GitRemote[]>;
};

const createFakeGitPort = ({
  canonicalPaths = {},
  gitRepositories = [],
  remotes = {},
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
  async shareGitCommonDirectory() {
    return true;
  },
  async listRemotes(workingDir) {
    return remotes[workingDir] ?? [];
  },
  async listBranches() {
    return [];
  },
  async getCurrentBranch() {
    return { detached: true };
  },
  async getStatus() {
    return [];
  },
  async getDiff() {
    return [];
  },
  async getWorktreeStatusData() {
    return {
      currentBranch: { detached: true },
      fileStatuses: [],
      fileDiffs: [],
      targetAheadBehind: { ahead: 0, behind: 0 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
    };
  },
  async getWorktreeStatusSummaryData() {
    return {
      currentBranch: { detached: true },
      fileStatuses: [],
      fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
      targetAheadBehind: { ahead: 0, behind: 0 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 0 },
    };
  },
  async commitsAheadBehind() {
    return { ahead: 0, behind: 0 };
  },
  async isAncestor() {
    return true;
  },
  async suggestedSquashCommitMessage() {
    return undefined;
  },
  async createWorktree() {
    throw new Error("unexpected create worktree");
  },
  async removeWorktree() {
    throw new Error("unexpected remove worktree");
  },
  async deleteLocalBranch() {
    throw new Error("unexpected delete local branch");
  },
  async mergeBranch() {
    throw new Error("unexpected merge branch");
  },
  async switchBranch() {
    throw new Error("unexpected switch branch");
  },
  async resetWorktreeSelection() {
    throw new Error("unexpected reset");
  },
  async fetchRemote() {
    throw new Error("unexpected fetch");
  },
  async pullBranch() {
    throw new Error("unexpected pull");
  },
  async commitAll() {
    throw new Error("unexpected commit");
  },
  async pushBranch() {
    throw new Error("unexpected push");
  },
  async rebaseBranch() {
    throw new Error("unexpected rebase");
  },
  async rebaseAbort() {
    throw new Error("unexpected rebase abort");
  },
  async abortConflict() {
    throw new Error("unexpected conflict abort");
  },
});

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

    await expect(service.detectGithubRepository({ repoPath: "/repo" })).resolves.toEqual({
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

    await expect(service.detectGithubRepository({ repoPath: "/repo" })).resolves.toBeNull();
  });

  test("rejects non-git repositories", async () => {
    const service = createGithubRepositoryDetectionService(
      createFakeGitPort({
        canonicalPaths: { "/repo": "/canonical/repo" },
      }),
    );

    await expect(service.detectGithubRepository({ repoPath: "/repo" })).rejects.toThrow(
      "Not a git repository: /canonical/repo",
    );
  });
});
