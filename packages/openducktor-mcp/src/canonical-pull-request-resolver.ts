import {
  type GitProviderRepository,
  gitProviderRepositoryKey,
  type KnownGitProviderId,
  type PullRequest,
  parseGitProviderRepositoryFromRemoteUrl,
} from "@openducktor/contracts";
import { nowIso, type ProcessRunner, runProcess } from "./beads-runtime";

const GITHUB_PROVIDER_ID: KnownGitProviderId = "github";
const GIT_PROVIDER_ENV: Record<string, string> = {
  GH_PROMPT_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
};

type GithubPullBranchRef = {
  ref: string;
};

type GithubPullResponse = {
  number: number;
  html_url: string;
  draft: boolean;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  head: GithubPullBranchRef;
};

export type ResolveCanonicalPullRequestInput = {
  providerId: KnownGitProviderId;
  number: number;
};

export type CanonicalPullRequestResolverPort = {
  resolve(input: ResolveCanonicalPullRequestInput): Promise<PullRequest>;
};

type DefaultCanonicalPullRequestResolverDeps = {
  runProcess?: ProcessRunner;
  now?: () => string;
};

const getCommandFailureDetail = (stdout: string, stderr: string): string => {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (trimmedStdout.length === 0) {
    return trimmedStderr;
  }
  if (trimmedStderr.length === 0) {
    return trimmedStdout;
  }
  return `${trimmedStdout}\n${trimmedStderr}`;
};

const parseGitHubState = (response: GithubPullResponse): PullRequest["state"] => {
  if (response.merged_at) {
    return "merged";
  }
  if (response.draft) {
    return "draft";
  }
  if (response.state.trim().toLowerCase() === "open") {
    return "open";
  }
  return "closed_unmerged";
};

const normalizeGitHubPullRequest = (
  response: GithubPullResponse,
  now: () => string,
): PullRequest => {
  return {
    providerId: GITHUB_PROVIDER_ID,
    number: response.number,
    url: response.html_url,
    state: parseGitHubState(response),
    createdAt: response.created_at,
    updatedAt: response.updated_at,
    lastSyncedAt: now(),
    ...(response.merged_at ? { mergedAt: response.merged_at } : {}),
    ...(response.closed_at ? { closedAt: response.closed_at } : {}),
  };
};

export class DefaultCanonicalPullRequestResolver implements CanonicalPullRequestResolverPort {
  private readonly repoPath: string;
  private readonly runProcess: ProcessRunner;
  private readonly now: () => string;

  constructor(repoPath: string, deps: DefaultCanonicalPullRequestResolverDeps = {}) {
    this.repoPath = repoPath;
    this.runProcess = deps.runProcess ?? runProcess;
    this.now = deps.now ?? nowIso;
  }

  async resolve(input: ResolveCanonicalPullRequestInput): Promise<PullRequest> {
    if (input.providerId !== GITHUB_PROVIDER_ID) {
      throw new Error(`Unsupported git provider for odt_set_pull_request: ${input.providerId}`);
    }

    const repository = await this.detectRepository();
    const payload = await this.runGhApi(repository, input.number);
    let response: GithubPullResponse;
    try {
      response = JSON.parse(payload) as GithubPullResponse;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown parse failure";
      throw new Error(`Failed to parse GitHub pull request response: ${detail}`);
    }

    return normalizeGitHubPullRequest(response, this.now);
  }

  private async detectRepository(): Promise<GitProviderRepository> {
    const remotes = await this.listGitRemotes();
    if (remotes.length === 0) {
      throw new Error("Unable to resolve a GitHub repository from git remotes.");
    }

    const uniqueRepositories = new Map<
      string,
      { remoteName: string; repository: GitProviderRepository }
    >();
    for (const remote of remotes) {
      const key = gitProviderRepositoryKey(remote.repository);
      if (!uniqueRepositories.has(key)) {
        uniqueRepositories.set(key, remote);
      }
    }

    if (uniqueRepositories.size === 1) {
      const firstRepository = uniqueRepositories.values().next().value;
      if (firstRepository) {
        return firstRepository.repository;
      }
      throw new Error("Unable to resolve a GitHub repository from git remotes.");
    }

    const originRemote = remotes.find((entry) => entry.remoteName === "origin");
    if (originRemote) {
      return originRemote.repository;
    }

    throw new Error(
      "Unable to resolve a single GitHub repository for odt_set_pull_request. Configure a unique origin remote for this repository.",
    );
  }

  private async listGitRemotes(): Promise<
    Array<{ remoteName: string; repository: GitProviderRepository }>
  > {
    const remoteNamesOutput = await this.runCommand("git", ["remote"]);
    const remoteNames = remoteNamesOutput
      .split("\n")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const remotes: Array<{ remoteName: string; repository: GitProviderRepository }> = [];

    for (const remoteName of remoteNames) {
      const remoteUrl = await this.runCommand("git", ["remote", "get-url", remoteName]);
      const repository = parseGitProviderRepositoryFromRemoteUrl(remoteUrl);
      if (!repository) {
        continue;
      }
      remotes.push({ remoteName, repository });
    }

    return remotes;
  }

  private async runGhApi(repository: GitProviderRepository, number: number): Promise<string> {
    const args = [
      "api",
      "--method",
      "GET",
      `repos/${repository.owner}/${repository.name}/pulls/${number}`,
    ];
    const fullArgs =
      repository.host.toLowerCase() === "github.com"
        ? args
        : ["--hostname", repository.host, ...args];
    return this.runCommand("gh", fullArgs);
  }

  private async runCommand(command: string, args: string[]): Promise<string> {
    const result = await this.runProcess(command, args, this.repoPath, GIT_PROVIDER_ENV);
    if (!result.ok) {
      const detail = getCommandFailureDetail(result.stdout, result.stderr);
      throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
    }
    return result.stdout.trim();
  }
}
