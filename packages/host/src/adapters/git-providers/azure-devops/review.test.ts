import { describe, expect, test } from "bun:test";
import type { AzureDevOpsRepository, PullRequest, RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { AzureDevOpsJson } from "./json";
import { createAzureDevOpsReviewPort } from "./review";
import { azureDevOpsResolvedRepositoryIdentity } from "@openducktor/core";
import type { AzureDevOpsRestClient } from "./rest-client";

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
    const repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
      detectRepository: () => Effect.die(new Error("unexpected detection")),
      getRepository: () => Effect.succeed(repository),
      getMapping: () => Effect.die(new Error("unexpected mapping")),
    };
    const client: AzureDevOpsRestClient = {
      request: (_config, _repository, request) =>
        request.operation === "resolve repository for review"
          ? Effect.succeed({ body: pullRequestResponse.repository, continuationToken: null })
          : request.operation === "read pull request review"
            ? Effect.succeed({ body: pullRequestResponse, continuationToken: null })
            : Effect.die(new Error(`unexpected request: ${request.operation}`)),
      readContinuationPages: (_config, _repository, request) => {
        if (request.operation === "read pull request threads") {
          return Effect.succeed([
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
          ]);
        }
        if (request.operation === "read pull request iterations") {
          return Effect.succeed([{ id: 1 }]);
        }
        return Effect.succeed([]);
      },
      readOffsetPages: () =>
        Effect.succeed([
          buildPolicy({ status: "queued", displayName: "Queued policy" }),
          buildPolicy({ status: "running", displayName: "Running policy" }),
          buildPolicy({ status: "notApplicable", displayName: "Skipped policy" }),
        ]),
    };
    const port = createAzureDevOpsReviewPort({ client, repositoryPort });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    expect(context).toMatchObject({
      status: "loaded",
      aggregateStatus: "pending",
      comments: [
        {
          id: "7:9",
          path: "/src/right.ts",
          line: 10,
          isResolved: true,
        },
        {
          id: "8:10",
          path: "/src/left.ts",
          line: 20,
          isResolved: false,
        },
        {
          id: "9:11",
          path: "/src/file.ts",
          line: null,
          isResolved: false,
        },
      ],
    });
    if (context.status !== "loaded") throw new Error("Expected loaded review context");
    expect(context.checks.map((check) => [check.name, check.status, check.conclusion])).toEqual([
      ["Queued policy", "queued", null],
      ["Running policy", "in_progress", null],
      ["Skipped policy", "completed", "skipped"],
    ]);
  });

  test("reports a cancelled Azure build as a failing aggregate", async () => {
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({
        policies: [
          buildPolicy({ status: "approved", displayName: "Build validation", buildId: 17 }),
        ],
        builds: {
          17: {
            id: 17,
            status: "completed",
            result: "canceled",
            definition: { name: "CI" },
          },
        },
      }),
    });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    expect(context).toMatchObject({ status: "loaded", aggregateStatus: "failure" });
  });

  test("reports an empty Azure check list as unknown", async () => {
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient(),
    });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    expect(context).toMatchObject({ status: "loaded", aggregateStatus: "unknown", checks: [] });
  });

  test("treats a list of skipped Azure policies as successful", async () => {
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({
        policies: [buildPolicy({ status: "notApplicable", displayName: "Skipped policy" })],
      }),
    });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    expect(context).toMatchObject({ status: "loaded", aggregateStatus: "success" });
  });

  test("reports one check per CI policy and omits completion rules", async () => {
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({
        policies: [
          policy({ status: "approved", typeId: REQUIRED_REVIEWERS_POLICY_TYPE_ID }),
          policy({ status: "rejected", typeId: MERGE_STRATEGY_POLICY_TYPE_ID }),
          buildPolicy({
            status: "rejected",
            displayName: "End-to-end suite",
            buildId: 17,
            isBlocking: false,
          }),
          buildPolicy({
            status: "queued",
            buildDefinitionName: "checks",
            buildId: 18,
            isExpired: true,
          }),
          {
            status: "queued",
            configuration: {
              id: 5,
              isBlocking: true,
              type: { id: STATUS_POLICY_TYPE_ID, displayName: "Status" },
              settings: { statusGenre: "sonar", statusName: "quality-gate" },
            },
          },
          {
            status: "queued",
            configuration: {
              id: 6,
              isBlocking: true,
              type: { id: STATUS_POLICY_TYPE_ID, displayName: "Status" },
              settings: {
                statusGenre: "security",
                statusName: "scan",
                defaultDisplayName: "Security scan",
              },
            },
          },
        ],
        statuses: [
          {
            state: "succeeded",
            context: { genre: "sonar", name: "quality-gate" },
            creationDate: "2026-09-19T10:00:00Z",
          },
        ],
        builds: {
          17: {
            id: 17,
            status: "completed",
            result: "failed",
            definition: { name: "e2e-tests" },
            _links: {
              web: { href: "https://dev.azure.com/OpenDucktor/Desktop/_build/results?buildId=17" },
            },
          },
        },
      }),
    });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    if (context.status !== "loaded") throw new Error("Expected loaded review context");
    expect(
      context.checks.map((check) => [check.name, check.status, check.conclusion, check.url]),
    ).toEqual([
      [
        "End-to-end suite",
        "completed",
        "failure",
        "https://dev.azure.com/OpenDucktor/Desktop/_build/results?buildId=17",
      ],
      ["checks", "queued", null, null],
      ["Security scan", "queued", null, null],
      ["sonar: quality-gate", "completed", "success", null],
    ]);
    expect(context.checks[0]?.details).toBe(
      "Optional build policy; Azure build status: completed; result: failed",
    );
  });

  test("maps vote threads to reviews and omits system comments", async () => {
    const systemComment = (id: number, content: string) => ({
      id,
      content,
      commentType: "system",
      author: { displayName: "Microsoft.TeamFoundation.System" },
    });
    const voteThread = (id: number, vote: string) => ({
      id,
      properties: {
        CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
        CodeReviewVoteResult: { $type: "System.String", $value: vote },
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
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({
        threads: [
          { id: 1, comments: [systemComment(1, "Policy status has been updated")] },
          { id: 2, comments: [systemComment(1, "Ada joined as a reviewer")] },
          voteThread(3, "10"),
          voteThread(4, "-5"),
          {
            id: 5,
            status: "active",
            comments: [{ id: 1, content: "Please rename this.", commentType: "text" }],
          },
        ],
      }),
    });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    if (context.status !== "loaded") throw new Error("Expected loaded review context");
    expect(
      context.comments.map((comment) => [
        comment.id,
        comment.source,
        comment.reviewOutcome ?? null,
        comment.body,
      ]),
    ).toEqual([
      ["3:1", "review", "approved", ""],
      ["4:1", "review", "changes_requested", "Waiting for author."],
      ["5:1", "review_thread", null, "Please rename this."],
    ]);
    expect(context.reviewThreads.openCount).toBe(1);
  });

  test("rejects a vote thread with an unsupported vote value", async () => {
    const port = createAzureDevOpsReviewPort({
      repositoryPort: reviewRepositoryPort,
      client: reviewClient({
        threads: [
          {
            id: 3,
            properties: {
              CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
              CodeReviewVoteResult: { $type: "System.String", $value: "7" },
            },
            comments: [{ id: 1, content: "Ada voted 7", commentType: "system" }],
          },
        ],
      }),
    });

    const result = await Effect.runPromise(
      Effect.flip(port.readContext({ repoConfig, linkedPullRequest: pullRequest })),
    );

    expect(result.message).toContain("unsupported vote value '7'");
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

const policy = ({ status, typeId }: { status: string; typeId: string }): AzureDevOpsJson => ({
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
}: {
  status: string;
  displayName?: string | null;
  buildDefinitionName?: string | null;
  buildId?: number;
  isBlocking?: boolean;
  isExpired?: boolean;
}): AzureDevOpsJson => ({
  status,
  configuration: {
    id: 1,
    isBlocking,
    type: { id: BUILD_POLICY_TYPE_ID, displayName: "Build" },
    settings: { buildDefinitionId: 3, displayName },
  },
  context:
    buildId === undefined
      ? null
      : { buildId, buildDefinitionName, isExpired, buildIsNotCurrent: false },
});

const reviewClient = ({
  policies = [],
  statuses = [],
  threads = [],
  builds = {},
}: {
  policies?: AzureDevOpsJson[];
  statuses?: AzureDevOpsJson[];
  threads?: AzureDevOpsJson[];
  builds?: Record<number, AzureDevOpsJson>;
} = {}): AzureDevOpsRestClient => ({
  request: (_config, _repository, request) => {
    if (request.operation === "resolve repository for review") {
      return Effect.succeed({ body: pullRequestResponse.repository, continuationToken: null });
    }
    if (request.operation === "read pull request review") {
      return Effect.succeed({ body: pullRequestResponse, continuationToken: null });
    }
    const buildId = Number(request.path.split("/").at(-1));
    const build = builds[buildId];
    return build === undefined
      ? Effect.die(new Error(`unexpected request: ${request.operation}`))
      : Effect.succeed({ body: build, continuationToken: null });
  },
  readContinuationPages: (_config, _repository, request) =>
    Effect.succeed(
      request.operation === "read pull request statuses"
        ? statuses
        : request.operation === "read pull request threads"
          ? threads
          : [],
    ),
  readOffsetPages: (_config, _repository, request) => {
    expect(request.query).toEqual({
      artifactId: "vstfs:///CodeReview/CodeReviewId/project-1/42",
    });
    return Effect.succeed(policies);
  },
});
