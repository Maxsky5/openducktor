import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import {
  findGithubPullRequestForBranch,
  type GithubCommandDependencies,
  pullRequestRecordsMatch,
} from "./github-pull-requests";

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/openducktor/openducktor/pull/42",
  state: "open",
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-02T10:00:00Z",
  lastSyncedAt: "2026-05-03T10:00:00Z",
  ...overrides,
});

describe("pullRequestRecordsMatch", () => {
  test("ignores sync timestamps so background polling does not churn unchanged tasks", () => {
    expect(
      pullRequestRecordsMatch(
        pullRequest({ lastSyncedAt: "2026-05-03T10:00:00Z" }),
        pullRequest({ lastSyncedAt: "2026-05-03T10:05:00Z" }),
      ),
    ).toBe(true);
  });

  test("detects user-visible pull request changes", () => {
    expect(
      pullRequestRecordsMatch(pullRequest({ state: "open" }), pullRequest({ state: "merged" })),
    ).toBe(false);
  });
});

describe("findGithubPullRequestForBranch", () => {
  test("disables inherited CLI color so gh api stdout remains parseable JSON", async () => {
    const commandCalls: Array<{
      args: string[];
      options: Parameters<SystemCommandPort["runCommandAllowFailure"]>[2];
    }> = [];
    const systemCommands: SystemCommandPort = {
      resolveCommandPath(command) {
        return Effect.succeed(command);
      },
      versionCommand() {
        return Effect.succeed("gh version 2.95.0");
      },
      runCommandAllowFailure(_command, args, options) {
        commandCalls.push({ args, options });
        const machineJson =
          options?.env?.NO_COLOR === "1" &&
          options.env.FORCE_COLOR === "0" &&
          options.env.CLICOLOR_FORCE === "0";
        return Effect.succeed({
          ok: true,
          stdout: machineJson ? "[]" : "\u001b[1;37m[\u001b[m\u001b[1;37m]\u001b[m\n",
          stderr: "",
        });
      },
    };
    const toolDiscovery: ToolDiscoveryPort = {
      resolveTool() {
        return Effect.succeed({
          displayLabel: "System PATH",
          path: "gh",
          sourceCategory: "system_path",
        });
      },
      resolveToolPath() {
        return Effect.succeed("gh");
      },
    };
    const dependencies: GithubCommandDependencies = {
      resolveGithubCommand: () => Effect.succeed({ ghCommand: "gh", systemCommands }),
      systemCommands,
      toolDiscovery,
    };

    const pullRequest = await Effect.runPromise(
      findGithubPullRequestForBranch(
        dependencies,
        "/repo",
        {
          repository: { host: "github.com", owner: "Maxsky5", name: "openducktor" },
          remoteName: "origin",
        },
        "odt/task-1",
        "open",
      ),
    );

    expect(pullRequest).toBeUndefined();
    expect(commandCalls[0]?.options?.env).toMatchObject({
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
      CLICOLOR: "0",
      CLICOLOR_FORCE: "0",
      FORCE_COLOR: "0",
    });
  });
});
