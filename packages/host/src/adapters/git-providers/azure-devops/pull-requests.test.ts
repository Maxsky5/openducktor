/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- Bun's mock wrapper does not preserve the fetch function metadata. */
import { describe, expect, mock, test } from "bun:test";
import type {
  AzureDevOpsRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import { createAzureDevOpsPullRequestPort } from "./pull-requests";
import { azureDevOpsResolvedRepositoryIdentity } from "./repository-identity";
import { createAzureDevOpsRestClient } from "./rest-client";

const repository: AzureDevOpsRepository = {
  providerId: "azure_devops",
  deployment: "services",
  serviceUrl: "https://dev.azure.com",
  organization: "OpenDucktor",
  project: "Desktop",
  name: "app",
};

const repoConfig: RepoConfig = {
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { provider: { id: "azure_devops", enabled: true, autoDetected: false, repository } },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};

const approval: TaskApprovalContext = {
  taskId: "task-42",
  taskStatus: "human_review",
  workingDirectory: "/worktrees/repo/task-42",
  sourceBranch: "odt/task-42",
  targetBranch: { remote: "origin", branch: "main" },
  defaultMergeMethod: "merge_commit",
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
};

const resolvedRepository = {
  id: "repository-1",
  name: "app",
  project: { id: "project-1", name: "Desktop" },
};

const pullRequestResponse = (number: number) => ({
  pullRequestId: number,
  status: "completed",
  isDraft: false,
  sourceRefName: "refs/heads/odt/task-42",
  targetRefName: "refs/heads/main",
  creationDate: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
  closedDate: new Date(Date.UTC(2026, 0, 2, 0, 0, number)).toISOString(),
  repository: resolvedRepository,
});

const connection: AzureDevOpsConnectionPort = {
  getAuthorization: () => Effect.succeed({ headerValue: "Bearer secret", account: null }),
  getState: () => Effect.dieMessage("unexpected connection state"),
  replaceServerPat: () => Effect.dieMessage("unexpected PAT replacement"),
  startCloudSignIn: () => Effect.dieMessage("unexpected sign-in"),
  cancelCloudSignIn: () => Effect.dieMessage("unexpected sign-in cancellation"),
  disconnect: () => Effect.dieMessage("unexpected disconnect"),
};

const repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
  detectRepository: () => Effect.dieMessage("unexpected detection"),
  getRepository: () => Effect.succeed(repository),
  getMapping: () => Effect.succeed({ repository, remoteName: "origin" }),
};

describe("Azure DevOps pull request adapter", () => {
  test("rejects a legacy link before it sends an Azure DevOps request", async () => {
    const requests: string[] = [];
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: mock(async (input: string | URL | Request) => {
        requests.push(String(input));
        return new Response(JSON.stringify(resolvedRepository));
      }) as unknown as typeof fetch,
    });
    const port = createAzureDevOpsPullRequestPort({ client, repositoryPort });
    const linkedPullRequest: PullRequest = {
      providerId: "azure_devops",
      number: 42,
      url: "https://dev.azure.com/OpenDucktor/Desktop/_git/app/pullrequest/42",
      state: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const failure = await Effect.runPromise(
      port.refresh({ repoConfig, linkedPullRequest }).pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.repositoryIdentity" });
    expect(requests).toEqual([]);
  });

  test("does not read a same-number pull request from another repository", async () => {
    const requests: string[] = [];
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: mock(async (input: string | URL | Request) => {
        requests.push(String(input));
        return new Response(JSON.stringify(resolvedRepository));
      }) as unknown as typeof fetch,
    });
    const port = createAzureDevOpsPullRequestPort({ client, repositoryPort });
    const linkedPullRequest: PullRequest = {
      providerId: "azure_devops",
      repositoryIdentity: azureDevOpsResolvedRepositoryIdentity({
        ...repository,
        projectId: "project-1",
        repositoryId: "repository-2",
      }),
      number: 42,
      url: "https://dev.azure.com/OpenDucktor/Desktop/_git/other/pullrequest/42",
      state: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const failure = await Effect.runPromise(
      port.refresh({ repoConfig, linkedPullRequest }).pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.repositoryIdentity" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toContain("pullrequests/42");
  });

  test("rejects an update when the linked pull request uses another source branch", async () => {
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: mock(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/pullrequests/42")) {
          return new Response(
            JSON.stringify({
              ...pullRequestResponse(42),
              status: "active",
              closedDate: undefined,
              sourceRefName: "refs/heads/odt/other-task",
            }),
          );
        }
        return new Response(JSON.stringify(resolvedRepository));
      }) as unknown as typeof fetch,
    });
    const port = createAzureDevOpsPullRequestPort({ client, repositoryPort });
    const linkedApproval = {
      ...approval,
      pullRequest: {
        providerId: "azure_devops",
        repositoryIdentity: azureDevOpsResolvedRepositoryIdentity({
          ...repository,
          projectId: "project-1",
          repositoryId: "repository-1",
        }),
        number: 42,
        url: "https://dev.azure.com/OpenDucktor/Desktop/_git/app/pullrequest/42",
        state: "open" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    const failure = await Effect.runPromise(
      port
        .upsert({ repoConfig, approval: linkedApproval, title: "Task 42", body: "Body" })
        .pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({ field: "sourceBranch" });
  });

  test("reads all offset pages when it finds the latest merged pull request", async () => {
    const urls: string[] = [];
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: mock(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        if (!url.pathname.endsWith("/pullrequests")) {
          return new Response(JSON.stringify(resolvedRepository));
        }
        const offset = Number(url.searchParams.get("$skip") ?? "0");
        const values =
          offset === 0
            ? Array.from({ length: 100 }, (_value, index) => pullRequestResponse(index + 1))
            : [pullRequestResponse(101)];
        return new Response(JSON.stringify({ value: values }));
      }) as unknown as typeof fetch,
    });
    const port = createAzureDevOpsPullRequestPort({ client, repositoryPort });

    const result = await Effect.runPromise(
      port.findLatestMergedForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }),
    );

    expect(result?.record.number).toBe(101);
    const pages = urls.filter((url) => new URL(url).pathname.endsWith("/pullrequests"));
    expect(pages).toHaveLength(2);
    expect(new URL(pages[1]!).searchParams.get("$skip")).toBe("100");
  });
});
