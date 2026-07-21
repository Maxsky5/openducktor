import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { GithubCommandDependencies } from "../tasks/support/github-pull-requests";
import { loadGithubPullRequestReviewOverview } from "./github-pull-request-review-overview";

const createDependencies = ({
  commands = [],
  response,
}: {
  commands?: string[][];
  response: unknown | ((args: string[]) => unknown);
}): GithubCommandDependencies => {
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure: (_command, args) => {
      commands.push(args);
      if (!args.join(" ").includes("PullRequestReviewOverview")) {
        return Effect.fail(
          new HostOperationError({
            operation: "gh",
            message: `Unexpected gh command: ${args.join(" ")}`,
          }),
        );
      }
      const payload = typeof response === "function" ? response(args) : response;
      return Effect.succeed({ ok: true, stdout: JSON.stringify(payload), stderr: "" });
    },
  };

  return {
    resolveGithubCommand: () =>
      Effect.succeed({
        ghCommand: "gh",
        systemCommands: systemCommands as SystemCommandPort,
      }),
    systemCommands: systemCommands as SystemCommandPort,
    toolDiscovery: {} as GithubCommandDependencies["toolDiscovery"],
  };
};

const input = (dependencies: GithubCommandDependencies) => ({
  dependencies,
  repoPath: "/repo",
  repository: { host: "github.com", owner: "openai", name: "openducktor" },
  pullRequestNumber: 42,
});

const reviewerAvatarUrl = "https://avatars.githubusercontent.com/u/1?v=4";

const responsePage = ({
  comments,
  commentsPageInfo = { hasNextPage: false, endCursor: null },
  reviews,
  reviewsPageInfo = { hasNextPage: false, endCursor: null },
}: {
  comments: unknown[];
  commentsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
  reviews: unknown[];
  reviewsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
}) => ({
  data: {
    repository: {
      pullRequest: {
        number: 42,
        title: "Rework panel",
        url: "https://github.com/openai/openducktor/pull/42",
        state: "OPEN",
        isDraft: false,
        comments: {
          nodes: comments,
          pageInfo: commentsPageInfo,
        },
        reviews: {
          nodes: reviews,
          pageInfo: reviewsPageInfo,
        },
      },
    },
  },
});

describe("loadGithubPullRequestReviewOverview", () => {
  test("loads pull request metadata, comments, reviews, authors, and avatars together", async () => {
    const commands: string[][] = [];
    const overview = await Effect.runPromise(
      loadGithubPullRequestReviewOverview(
        input(
          createDependencies({
            commands,
            response: responsePage({
              comments: [
                {
                  id: "comment-1",
                  author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
                  body: "Please check spacing.",
                  url: "https://github.com/openai/openducktor/pull/42#issuecomment-1",
                  createdAt: "2026-07-08T10:00:00Z",
                  updatedAt: "2026-07-08T10:01:00Z",
                },
              ],
              reviews: [
                {
                  id: "review-1",
                  author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
                  body: "Changes requested.",
                  url: "https://github.com/openai/openducktor/pull/42#pullrequestreview-1",
                  createdAt: "2026-07-08T10:02:00Z",
                  submittedAt: "2026-07-08T10:03:00Z",
                  updatedAt: "2026-07-08T10:04:00Z",
                },
              ],
            }),
          }),
        ),
      ),
    );

    expect(overview.pullRequest).toEqual({
      providerId: "github",
      number: 42,
      title: "Rework panel",
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open",
    });
    expect(overview.comments).toEqual([
      {
        id: "comment-1",
        author: "reviewer",
        authorAvatarUrl: reviewerAvatarUrl,
        body: "Please check spacing.",
        patch: null,
        suggestionPatches: [],
        url: "https://github.com/openai/openducktor/pull/42#issuecomment-1",
        createdAt: "2026-07-08T10:00:00Z",
        updatedAt: "2026-07-08T10:01:00Z",
        path: null,
        line: null,
        threadId: null,
        isResolved: null,
        source: "comment",
      },
      {
        id: "review-1",
        author: "reviewer",
        authorAvatarUrl: reviewerAvatarUrl,
        body: "Changes requested.",
        patch: null,
        suggestionPatches: [],
        url: "https://github.com/openai/openducktor/pull/42#pullrequestreview-1",
        createdAt: "2026-07-08T10:03:00Z",
        updatedAt: "2026-07-08T10:04:00Z",
        path: null,
        line: null,
        threadId: null,
        isResolved: null,
        source: "review",
      },
    ]);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.join(" ")).toContain("avatarUrl(size: 64)");
    const command = commands[0] ?? [];
    const flagFor = (argument: string): string | undefined => {
      const index = command.indexOf(argument);
      return index > 0 ? command[index - 1] : undefined;
    };
    expect(flagFor("owner=openai")).toBe("-f");
    expect(flagFor("name=openducktor")).toBe("-f");
    expect(flagFor("number=42")).toBe("-F");
    expect(flagFor("includeComments=true")).toBe("-F");
    expect(flagFor("includeReviews=true")).toBe("-F");
  });

  test("paginates comments and reviews independently without refetching completed connections", async () => {
    const commands: string[][] = [];
    const response = (args: string[]): unknown => {
      const command = args.join(" ");
      if (command.includes("commentsCursor=comments-page-2")) {
        expect(command).toContain("includeComments=true");
        expect(command).toContain("includeReviews=false");
        return responsePage({
          comments: [
            {
              id: "comment-2",
              author: null,
              body: "Second comment page.",
              url: "https://example.com/comment-2",
              createdAt: "2026-07-08T10:05:00Z",
              updatedAt: "2026-07-08T10:05:00Z",
            },
          ],
          reviews: [],
        });
      }
      return responsePage({
        comments: [
          {
            id: "comment-1",
            author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
            body: "First comment page.",
            url: "https://example.com/comment-1",
            createdAt: "2026-07-08T10:00:00Z",
            updatedAt: "2026-07-08T10:00:00Z",
          },
        ],
        commentsPageInfo: { hasNextPage: true, endCursor: "comments-page-2" },
        reviews: [
          {
            id: "review-1",
            author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
            body: "Only review page.",
            url: "https://example.com/review-1",
            createdAt: "2026-07-08T10:02:00Z",
            submittedAt: null,
            updatedAt: "2026-07-08T10:02:00Z",
          },
        ],
      });
    };

    const overview = await Effect.runPromise(
      loadGithubPullRequestReviewOverview(input(createDependencies({ commands, response }))),
    );

    expect(overview.comments.map((comment) => comment.id)).toEqual([
      "comment-1",
      "comment-2",
      "review-1",
    ]);
    expect(overview.comments[1]).toMatchObject({ author: null, authorAvatarUrl: null });
    expect(commands).toHaveLength(2);
  });

  test("rejects malformed GraphQL connections through the typed error channel", async () => {
    const malformed = {
      data: {
        repository: {
          pullRequest: {
            number: 42,
            title: "Rework panel",
            url: "https://github.com/openai/openducktor/pull/42",
            state: "OPEN",
            isDraft: false,
            comments: { nodes: [], pageInfo: null },
            reviews: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    };

    const result = await Effect.runPromise(
      loadGithubPullRequestReviewOverview(input(createDependencies({ response: malformed }))).pipe(
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("HostValidationError");
      expect(result.left.field).toBe("pullRequest.comments.pageInfo");
    }
  });
});
