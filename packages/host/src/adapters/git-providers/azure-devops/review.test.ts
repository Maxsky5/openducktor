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
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
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
  test("preserves policy, reviewer, and thread states", async () => {
    const repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
      detectRepository: () => Effect.dieMessage("unexpected detection"),
      getRepository: () => Effect.succeed(repository),
      getMapping: () => Effect.dieMessage("unexpected mapping"),
    };
    const client: AzureDevOpsRestClient = {
      request: (_config, _repository, request) =>
        request.operation === "resolve repository for review"
          ? Effect.succeed({ body: pullRequestResponse.repository, continuationToken: null })
          : request.operation === "read pull request review"
            ? Effect.succeed({ body: pullRequestResponse, continuationToken: null })
            : Effect.dieMessage(`unexpected request: ${request.operation}`),
      readContinuationPages: (_config, _repository, request) => {
        if (request.operation === "read pull request reviewers") {
          return Effect.succeed([
            {
              id: "reviewer-1",
              displayName: "Ada Lovelace",
              vote: 5,
              isRequired: true,
            },
          ]);
        }
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
          {
            status: "queued",
            configuration: { id: 1, type: { displayName: "Queued policy" } },
          },
          {
            status: "running",
            configuration: { id: 2, type: { displayName: "Running policy" } },
          },
          {
            status: "notApplicable",
            configuration: { id: 3, type: { displayName: "Skipped policy" } },
          },
        ]),
    };
    const port = createAzureDevOpsReviewPort({ client, repositoryPort });

    const context = await Effect.runPromise(
      port.readContext({ repoConfig, linkedPullRequest: pullRequest }),
    );

    expect(context).toMatchObject({
      status: "loaded",
      aggregateStatus: "pending",
      reviewers: [
        {
          displayName: "Ada Lovelace",
          decision: "approved_with_suggestions",
          isRequired: true,
        },
      ],
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
          {
            status: "approved",
            configuration: { id: 1, type: { displayName: "Build validation" } },
            context: { buildId: 17 },
          },
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
        return Effect.dieMessage(`unexpected request: ${request.operation}`);
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
  detectRepository: () => Effect.dieMessage("unexpected detection"),
  getRepository: () => Effect.succeed(repository),
  getMapping: () => Effect.dieMessage("unexpected mapping"),
};

type AzureBuildFixture = {
  id: number;
  status: string;
  result: string;
  definition: { name: string };
};

const reviewClient = ({
  policies = [],
  builds = {},
}: {
  policies?: AzureDevOpsJson[];
  builds?: Record<number, AzureBuildFixture>;
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
      ? Effect.dieMessage(`unexpected request: ${request.operation}`)
      : Effect.succeed({ body: build, continuationToken: null });
  },
  readContinuationPages: () => Effect.succeed([]),
  readOffsetPages: () => Effect.succeed(policies),
});
