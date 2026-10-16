import { describe, expect, test } from "bun:test";
import type {
  AzureDevOpsRepository,
  PullRequest,
  PullRequestReviewContext,
  RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { AzureDevOpsJson } from "./json";
import { createAzureDevOpsReviewPort } from "./review";
import { azureDevOpsResolvedRepositoryIdentity } from "@openducktor/core";
import type { AzureDevOpsRequest, AzureDevOpsRestClient } from "./rest-client";

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
  git: {
    provider: {
      id: "azure_devops",
      enabled: true,
      autoDetected: false,
      repository,
    },
  },
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};

const pullRequest: PullRequest = {
  providerId: "azure_devops",
  repositoryIdentity: azureDevOpsResolvedRepositoryIdentity({
    ...repository,
    projectId: "project-1",
    repositoryId: "repository-1",
  }),
  number: 42,
  url: "https://dev.azure.com/OpenDucktor/Desktop/_git/app/pullrequest/42",
  state: "open",
  createdAt: "2026-09-18T10:00:00Z",
  updatedAt: "2026-09-19T10:00:00Z",
};

const pullRequestResponse = {
  pullRequestId: 42,
  title: "Add Azure DevOps",
  status: "active",
  isDraft: false,
  sourceRefName: "refs/heads/odt/task-42",
  targetRefName: "refs/heads/main",
  creationDate: "2026-09-18T10:00:00Z",
  repository: {
    id: "repository-1",
    name: "app",
    project: { id: "project-1", name: "Desktop" },
  },
  _links: { web: { href: pullRequest.url } },
};

describe("Azure DevOps review adapter", () => {
  test("preserves policy and thread states", async () => {
    const context = await readLoadedContext({
      iterations: [{ id: 1 }],
      threads: [
        {
          id: 7,
          status: "wontFix",
          threadContext: {
            filePath: "/src/right.ts",
            rightFileStart: { line: 10 },
            rightFileEnd: { line: 12 },
          },
          comments: [{ id: 9, content: "Keep this behavior.", author: { displayName: "Ada" } }],
        },
        {
          id: 8,
          status: "active",
          threadContext: {
            filePath: "/src/left.ts",
            leftFileStart: { line: 20 },
            leftFileEnd: { line: 22 },
          },
          comments: [{ id: 10, content: "Deleted line.", author: { displayName: "Grace" } }],
        },
        {
          id: 9,
          status: "pending",
          threadContext: { filePath: "/src/file.ts" },
          comments: [{ id: 11, content: "File comment.", author: { displayName: "Linus" } }],
        },
      ],
      policies: [
        buildPolicy({ status: "queued", displayName: "Queued policy" }),
        buildPolicy({ status: "running", displayName: "Running policy" }),
        buildPolicy({ status: "notApplicable", displayName: "Skipped policy" }),
      ],
    });

    expect(context).toMatchObject({
      aggregateStatus: "pending",
      comments: [
        { id: "7:9", path: "/src/right.ts", line: 10, isResolved: true },
        { id: "8:10", path: "/src/left.ts", line: 20, isResolved: false },
        { id: "9:11", path: "/src/file.ts", line: null, isResolved: false },
      ],
    });
    expect(context.checks.map((check) => [check.name, check.status, check.conclusion])).toEqual([
      ["Queued policy", "queued", null],
      ["Running policy", "in_progress", null],
      ["Skipped policy", "completed", "skipped"],
    ]);
  });

  test("requests only the policy evaluations that apply to the pull request", async () => {
    const requests: AzureDevOpsRequest[] = [];

    await readLoadedContext({ requests });

    expect(
      requests.find((request) => request.operation === "read policy evaluations")?.query,
    ).toEqual({ artifactId: "vstfs:///CodeReview/CodeReviewId/project-1/42" });
  });

  test("reports an empty Azure check list as unknown", async () => {
    const context = await readLoadedContext();

    expect(context).toMatchObject({ aggregateStatus: "unknown", checks: [] });
  });

  test("treats a list of skipped Azure policies as successful", async () => {
    const context = await readLoadedContext({
      policies: [buildPolicy({ status: "notApplicable", displayName: "Skipped policy" })],
    });

    expect(context.aggregateStatus).toBe("success");
  });

  test("drops non-CI policies", async () => {
    const context = await readLoadedContext({
      policies: [
        nonCiPolicy({ status: "approved", typeId: REQUIRED_REVIEWERS_POLICY_TYPE_ID }),
        nonCiPolicy({ status: "rejected", typeId: MERGE_STRATEGY_POLICY_TYPE_ID }),
        buildPolicy({ status: "approved", displayName: "Build and Lint" }),
      ],
    });

    expect(context.checks.map((check) => check.name)).toEqual(["Build and Lint"]);
    expect(context.aggregateStatus).toBe("success");
  });

  test("keeps the build policy verdict and adds the current build link and times", async () => {
    const context = await readLoadedContext({
      policies: [
        buildPolicy({
          status: "rejected",
          displayName: "End-to-end suite",
          buildId: 17,
          isBlocking: false,
        }),
      ],
      builds: { 17: build({ id: 17, result: "partiallySucceeded" }) },
    });

    expect(context.checks).toEqual([
      {
        name: "End-to-end suite",
        workflow: "Azure Pipelines",
        status: "completed",
        conclusion: "failure",
        url: buildUrl(17),
        details:
          "Optional build policy; Azure policy state: rejected; Azure build status: completed; result: partiallysucceeded",
        startedAt: "2026-09-19T10:00:00Z",
        completedAt: "2026-09-19T10:05:00Z",
      },
    ]);
    expect(context.aggregateStatus).toBe("failure");
  });

  test("does not read a build that the build policy no longer evaluates", async () => {
    const requests: AzureDevOpsRequest[] = [];

    const context = await readLoadedContext({
      requests,
      policies: [
        buildPolicy({
          status: "queued",
          buildDefinitionName: "checks",
          buildId: 18,
          isExpired: true,
        }),
        buildPolicy({ status: "queued", buildId: 19, buildIsNotCurrent: true }),
      ],
    });

    expect(context.checks.map((check) => [check.name, check.status, check.url])).toEqual([
      ["checks", "queued", null],
      ["Build 3", "queued", null],
    ]);
    expect(requests.some((request) => request.path.startsWith("build/builds/"))).toBe(false);
  });

  test("keeps the status policy verdict and name when its status is posted", async () => {
    const context = await readLoadedContext({
      iterations: [{ id: 2 }],
      policies: [
        statusPolicy({
          status: "rejected",
          genre: "security",
          name: "scan",
          defaultDisplayName: "Security scan",
        }),
        statusPolicy({ status: "queued", genre: "sonar", name: "quality-gate" }),
      ],
      iterationStatuses: [
        postedStatus({ genre: "security", name: "scan", state: "succeeded" }),
        postedStatus({ genre: "lint", name: "style", state: "succeeded" }),
      ],
    });

    expect(
      context.checks.map((check) => [check.name, check.status, check.conclusion, check.url]),
    ).toEqual([
      ["Security scan", "completed", "failure", "https://ci.example.com/security/scan"],
      ["sonar: quality-gate", "queued", null, null],
      ["lint: style", "completed", "success", "https://ci.example.com/lint/style"],
    ]);
    expect(context.checks[0]?.details).toBe(
      "Required status policy; Azure policy state: rejected; security scan",
    );
  });

  test("maps vote threads to reviews and omits system comments", async () => {
    const systemComment = (id: number, content: string) => ({
      id,
      content,
      commentType: "system",
      author: { displayName: "Microsoft.TeamFoundation.System" },
    });
    const context = await readLoadedContext({
      threads: [
        { id: 1, comments: [systemComment(1, "Policy status has been updated")] },
        { id: 2, comments: [systemComment(1, "Ada joined as a reviewer")] },
        voteThread(3, "10"),
        voteThread(4, "5"),
        voteThread(5, "0"),
        voteThread(6, "-5"),
        voteThread(7, "-10"),
        {
          ...voteThread(8, "10"),
          comments: [{ id: 1, content: "Ada voted 10", commentType: "system", isDeleted: true }],
        },
        {
          id: 9,
          status: "active",
          comments: [{ id: 1, content: "Please rename this.", commentType: "text" }],
        },
      ],
    });

    expect(
      context.comments.map((comment) => [
        comment.id,
        comment.source,
        comment.reviewOutcome ?? null,
        comment.body,
      ]),
    ).toEqual([
      ["3:1", "review", "approved", ""],
      ["4:1", "review", "approved", "Approved with suggestions."],
      ["5:1", "review", "dismissed", ""],
      ["6:1", "review", "changes_requested", "Waiting for author."],
      ["7:1", "review", "changes_requested", "Rejected."],
      ["9:1", "review_thread", null, "Please rename this."],
    ]);
    expect(context.comments[0]).toMatchObject({
      author: "Ada",
      authorAvatarUrl: "https://dev.azure.com/OpenDucktor/_apis/avatars/ada",
      createdAt: "2026-09-19T10:00:00Z",
      threadId: null,
      isResolved: null,
    });
    expect(context.reviewThreads.openCount).toBe(1);
  });

  test("credits a vote to the display name property when Azure attributes it to a service account", async () => {
    const thread = voteThread(3, "10");
    const context = await readLoadedContext({
      threads: [
        {
          id: thread.id,
          properties: {
            CodeReviewThreadType: thread.properties.CodeReviewThreadType,
            CodeReviewVoteResult: thread.properties.CodeReviewVoteResult,
            CodeReviewVotedByDisplayName: { $type: "System.String", $value: "Grace" },
          },
          comments: [
            {
              id: 1,
              content: "Grace voted 10",
              commentType: "system",
              author: {
                displayName: "[DefaultCollection]\\Project Collection Service Accounts",
                imageUrl: "https://dev.azure.com/OpenDucktor/_apis/avatars/service",
              },
            },
          ],
        },
      ],
    });

    expect(context.comments).toMatchObject([
      { source: "review", reviewOutcome: "approved", author: "Grace", authorAvatarUrl: null },
    ]);
  });

  test("rejects a vote thread that does not identify the voter", async () => {
    const thread = voteThread(3, "10");
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({ threads: [{ ...thread, identities: {} }] }),
    });

    const result = await Effect.runPromise(
      Effect.flip(port.readContext({ repoConfig, linkedPullRequest: pullRequest })),
    );

    expect(result.message).toContain("vote thread 3 does not identify the voter");
  });

  test.each([
    ["an unsupported", "7", "unsupported vote value '7'"],
    ["a missing", null, "unsupported vote value 'missing'"],
  ])("rejects a vote thread with %s vote value", async (_label, vote, message) => {
    const thread = voteThread(3, "10");
    const properties =
      vote === null
        ? {
            CodeReviewThreadType: thread.properties.CodeReviewThreadType,
            CodeReviewVotedByIdentity: thread.properties.CodeReviewVotedByIdentity,
          }
        : {
            ...thread.properties,
            CodeReviewVoteResult: { $type: "System.String", $value: vote },
          };
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({ threads: [{ ...thread, properties }] }),
    });

    const result = await Effect.runPromise(
      Effect.flip(port.readContext({ repoConfig, linkedPullRequest: pullRequest })),
    );

    expect(result.message).toContain(message);
  });

  test("maps Azure code suggestions to the shared suggestion patch model", async () => {
    const originalLine =
      '      "serverError": "Erreur du serveur de connexion. Veuillez réessayer.",';
    const suggestedLine = '      "serverError": "Erreur de connexion. Veuillez réessayer.",';
    const client: AzureDevOpsRestClient = {
      request: (_config, _repository, request) => {
        if (request.operation === "resolve repository for review") {
          return Effect.succeed({ body: pullRequestResponse.repository, continuationToken: null });
        }
        if (request.operation === "read pull request review") {
          return Effect.succeed({ body: pullRequestResponse, continuationToken: null });
        }
        if (request.operation === "read pull request suggestion file") {
          expect(request.path).toBe("git/repositories/repository-1/items");
          expect(request.query).toEqual({
            $format: "json",
            path: "/src/locales/fr.json",
            includeContent: true,
            "versionDescriptor.version": "latest-source-commit",
            "versionDescriptor.versionType": "commit",
          });
          return Effect.succeed({
            body: { content: `${"unchanged\n".repeat(210)}${originalLine}\n` },
            continuationToken: null,
          });
        }
        return Effect.die(new Error(`unexpected request: ${request.operation}`));
      },
      readContinuationPages: (_config, _repository, request) =>
        request.operation === "read pull request iterations"
          ? Effect.succeed([
              { id: 1, sourceRefCommit: { commitId: "older-source-commit" } },
              { id: 2, sourceRefCommit: { commitId: "latest-source-commit" } },
            ])
          : request.operation === "read pull request threads"
            ? Effect.succeed([
                {
                  id: 12,
                  status: "active",
                  pullRequestThreadContext: {
                    iterationContext: { firstComparingIteration: 1, secondComparingIteration: 2 },
                  },
                  threadContext: {
                    filePath: "/src/locales/fr.json",
                    rightFileStart: { line: 211, offset: 1 },
                    rightFileEnd: { line: 211, offset: originalLine.length + 1 },
                  },
                  comments: [
                    {
                      id: 13,
                      content: `Use that **label** instead:\n\n\`\`\`suggestion\n${suggestedLine}\n\`\`\`\n`,
                      author: { displayName: "Maxime" },
                    },
                  ],
                },
                {
                  id: 14,
                  status: "active",
                  pullRequestThreadContext: {
                    iterationContext: { firstComparingIteration: 1, secondComparingIteration: 1 },
                  },
                  threadContext: {
                    filePath: "/src/locales/fr.json",
                    rightFileStart: { line: 211, offset: 1 },
                    rightFileEnd: { line: 211, offset: originalLine.length + 1 },
                  },
                  comments: [
                    {
                      id: 15,
                      content: `Older suggestion:\n\n\`\`\`suggestion\n${suggestedLine}\n\`\`\``,
                      author: { displayName: "Maxime" },
                    },
                  ],
                },
              ])
            : Effect.succeed([]),
      readOffsetPages: () => Effect.succeed([]),
    };
    const port = createAzureDevOpsReviewPort({ client, repositoryPort: reviewRepositoryPort });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    if (context.status !== "loaded") throw new Error("Expected loaded review context");
    expect(context.comments).toContainEqual(
      expect.objectContaining({
        id: "12:13",
        body: "Use that **label** instead:",
        suggestionPatches: [
          ["@@ -211,1 +211,1 @@", `-${originalLine}`, `+${suggestedLine}`].join("\n"),
        ],
        suggestionWarning: null,
      }),
    );
    expect(context.comments).toContainEqual(
      expect.objectContaining({
        id: "14:15",
        body: expect.stringContaining("```suggestion"),
        suggestionPatches: [],
        suggestionWarning: expect.stringContaining("current pull request iteration"),
      }),
    );
  });
});

const reviewRepositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
  detectRepository: () => Effect.die(new Error("unexpected detection")),
  getRepository: () => Effect.succeed(repository),
  getMapping: () => Effect.die(new Error("unexpected mapping")),
};

const BUILD_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";
const STATUS_POLICY_TYPE_ID = "cbdc66da-9728-4af8-aada-9a5a32e4a226";
const REQUIRED_REVIEWERS_POLICY_TYPE_ID = "fd2167ab-b0be-447a-8ec8-39368250530e";
const MERGE_STRATEGY_POLICY_TYPE_ID = "fa4e907d-c16b-4a4c-9dfa-4916e5d171ab";

const nonCiPolicy = ({ status, typeId }: { status: string; typeId: string }): AzureDevOpsJson => ({
  status,
  configuration: { id: 1, isBlocking: true, type: { id: typeId, displayName: "Policy" } },
});

const buildPolicy = ({
  status,
  displayName = null,
  buildDefinitionName = null,
  buildId,
  isBlocking = true,
  isExpired = false,
  buildIsNotCurrent = false,
}: {
  status: string;
  displayName?: string | null;
  buildDefinitionName?: string | null;
  buildId?: number;
  isBlocking?: boolean;
  isExpired?: boolean;
  buildIsNotCurrent?: boolean;
}): AzureDevOpsJson => ({
  status,
  configuration: {
    id: 1,
    isBlocking,
    type: { id: BUILD_POLICY_TYPE_ID, displayName: "Build" },
    settings: { buildDefinitionId: 3, displayName },
  },
  context:
    buildId === undefined ? null : { buildId, buildDefinitionName, isExpired, buildIsNotCurrent },
});

const statusPolicy = ({
  status,
  genre,
  name,
  defaultDisplayName = null,
}: {
  status: string;
  genre: string;
  name: string;
  defaultDisplayName?: string | null;
}): AzureDevOpsJson => ({
  status,
  configuration: {
    id: 2,
    isBlocking: true,
    type: { id: STATUS_POLICY_TYPE_ID, displayName: "Status" },
    settings: { statusGenre: genre, statusName: name, defaultDisplayName },
  },
});

const postedStatus = ({
  genre,
  name,
  state,
}: {
  genre: string;
  name: string;
  state: string;
}): AzureDevOpsJson => ({
  state,
  description: `${genre} ${name}`,
  targetUrl: `https://ci.example.com/${genre}/${name}`,
  context: { genre, name },
  creationDate: "2026-09-19T10:00:00Z",
});

const buildUrl = (id: number): string =>
  `https://dev.azure.com/OpenDucktor/Desktop/_build/results?buildId=${id}`;

const build = ({ id, result }: { id: number; result: string }): AzureDevOpsJson => ({
  id,
  status: "completed",
  result,
  definition: { name: "CI" },
  startTime: "2026-09-19T10:00:00Z",
  finishTime: "2026-09-19T10:05:00Z",
  _links: { web: { href: buildUrl(id) } },
});

const voteThread = (id: number, vote: string) => ({
  id,
  properties: {
    CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
    CodeReviewVoteResult: { $type: "System.String", $value: vote },
    CodeReviewVotedByIdentity: { $type: "System.String", $value: "1" },
  },
  identities: {
    "1": { displayName: "Ada", imageUrl: "https://dev.azure.com/OpenDucktor/_apis/avatars/ada" },
  },
  comments: [
    {
      id: 1,
      content: `Ada voted ${vote}`,
      commentType: "system",
      author: { displayName: "Ada" },
      publishedDate: "2026-09-19T10:00:00Z",
    },
  ],
});

type ReviewFixtures = {
  policies?: AzureDevOpsJson[];
  statuses?: AzureDevOpsJson[];
  iterationStatuses?: AzureDevOpsJson[];
  iterations?: AzureDevOpsJson[];
  threads?: AzureDevOpsJson[];
  builds?: Record<number, AzureDevOpsJson>;
  requests?: AzureDevOpsRequest[];
};

const reviewClient = ({
  policies = [],
  statuses = [],
  iterationStatuses = [],
  iterations = [],
  threads = [],
  builds = {},
  requests = [],
}: ReviewFixtures = {}): AzureDevOpsRestClient => {
  const pages = new Map<string, AzureDevOpsJson[]>([
    ["read pull request statuses", statuses],
    ["read pull request iteration statuses", iterationStatuses],
    ["read pull request iterations", iterations],
    ["read pull request threads", threads],
  ]);
  return {
    request: (_config, _repository, request) => {
      requests.push(request);
      if (request.operation === "resolve repository for review") {
        return Effect.succeed({ body: pullRequestResponse.repository, continuationToken: null });
      }
      if (request.operation === "read pull request review") {
        return Effect.succeed({ body: pullRequestResponse, continuationToken: null });
      }
      const build = Object.entries(builds).find(([id]) => request.path === `build/builds/${id}`);
      return build === undefined
        ? Effect.die(new Error(`unexpected request: ${request.operation}`))
        : Effect.succeed({ body: build[1], continuationToken: null });
    },
    readContinuationPages: (_config, _repository, request) => {
      requests.push(request);
      return Effect.succeed(pages.get(request.operation) ?? []);
    },
    readOffsetPages: (_config, _repository, request) => {
      requests.push(request);
      return Effect.succeed(policies);
    },
  };
};

const readLoadedContext = async (
  fixtures: ReviewFixtures = {},
): Promise<Extract<PullRequestReviewContext, { status: "loaded" }>> => {
  const port = createAzureDevOpsReviewPort({
    repositoryPort: reviewRepositoryPort,
    client: reviewClient(fixtures),
  });
  const context = await Effect.runPromise(
    port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
  );
  if (context.status !== "loaded") throw new Error("Expected loaded review context");
  return context;
};
