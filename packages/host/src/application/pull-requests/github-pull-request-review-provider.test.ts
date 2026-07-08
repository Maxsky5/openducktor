import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { GithubCommandDependencies } from "../tasks/support/github-pull-requests";
import { createGithubPullRequestReviewProvider } from "./github-pull-request-review-provider";

const createDependencies = (): GithubCommandDependencies => {
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure: (_command, args) => {
      const command = args.join(" ");
      if (command.includes("pr view")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify({
            number: 42,
            title: "Rework panel",
            url: "https://github.com/openai/openducktor/pull/42",
            state: "OPEN",
            isDraft: false,
            comments: [
              {
                id: "comment-1",
                author: { login: "reviewer" },
                body: "Please check spacing.",
                url: "https://github.com/openai/openducktor/pull/42#issuecomment-1",
                createdAt: "2026-07-08T10:00:00Z",
                updatedAt: "2026-07-08T10:01:00Z",
              },
            ],
            reviews: [
              {
                id: "review-1",
                author: { login: "reviewer" },
                body: "Changes requested.",
                state: "CHANGES_REQUESTED",
                submittedAt: "2026-07-08T10:02:00Z",
              },
            ],
          }),
          stderr: "",
        });
      }
      if (command.includes("pr checks")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify([
            {
              name: "lint",
              workflow: "CI",
              state: "SUCCESS",
              bucket: "pass",
              link: "https://github.com/openai/openducktor/actions/runs/1",
            },
            {
              name: "test",
              workflow: "CI",
              state: "FAILURE",
              bucket: "fail",
              link: "https://github.com/openai/openducktor/actions/runs/2",
            },
          ]),
          stderr: "",
        });
      }
      return Effect.fail(
        new HostOperationError({
          operation: "gh",
          message: `Unexpected gh command: ${command}`,
        }),
      );
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

describe("createGithubPullRequestReviewProvider", () => {
  test("loads checks and comments through the gh command boundary", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies(),
        repoPath: "/repo",
        context: {
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          remoteName: "origin",
        },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.pullRequest).toMatchObject({
      providerId: "github",
      number: 42,
      title: "Rework panel",
      state: "open",
    });
    expect(context.aggregateStatus).toBe("failure");
    expect(context.checks.map((check) => [check.name, check.conclusion])).toEqual([
      ["lint", "success"],
      ["test", "failure"],
    ]);
    expect(context.comments.map((comment) => [comment.id, comment.source])).toEqual([
      ["comment-1", "comment"],
      ["review-1", "review"],
    ]);
  });
});
