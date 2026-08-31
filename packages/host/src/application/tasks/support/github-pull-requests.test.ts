import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGithubCliAdapter } from "../../../adapters/git-providers/github-cli";
import type { GitPort } from "../../../ports/git-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import {
  findGithubPullRequestForBranch,
  type GithubCommandDependencies,
  type GithubRepositoryDependencies,
  githubPullRequestSyncPolicy,
  pullRequestRecordsMatch,
  requireGithubPullRequestReadRepository,
} from "./github-pull-requests";
import { parseGithubPullListResponse, parseGithubPullResponse } from "./github-pull-request-model";

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

const githubPullResponse = {
  number: 42,
  html_url: "https://github.com/openducktor/openducktor/pull/42",
  state: "open",
  draft: false,
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-02T10:00:00Z",
  merged_at: null,
  closed_at: null,
  head: { ref: "odt/task-42" },
  base: { ref: "main" },
};

describe("GitHub pull request response parsing", () => {
  test("parses the exact gh response fields used by task state", () => {
    expect(parseGithubPullResponse(JSON.stringify(githubPullResponse))).toMatchObject({
      record: {
        number: 42,
        state: "open",
        url: "https://github.com/openducktor/openducktor/pull/42",
      },
      sourceBranch: "odt/task-42",
      targetBranch: "main",
    });
  });

  test("flattens paginated gh arrays after validating every pull request", () => {
    expect(parseGithubPullListResponse(JSON.stringify([[githubPullResponse]]))).toHaveLength(1);
  });

  test("rejects a response whose known branch contract is malformed", () => {
    const malformed = { ...githubPullResponse, head: { ref: 42 } };
    expect(() => parseGithubPullResponse(JSON.stringify(malformed))).toThrow(
      "GitHub pull request response field head.ref is missing or invalid.",
    );
  });

  test("rejects padded external identifiers instead of rewriting them", () => {
    const padded = { ...githubPullResponse, head: { ref: "odt/task-42 " } };
    expect(() => parseGithubPullResponse(JSON.stringify(padded))).toThrow(
      "GitHub pull request response field head.ref is missing or invalid.",
    );
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
      discoverTool() {
        return Effect.succeed({
          displayLabel: "System PATH",
          path: "gh",
          sourceCategory: "system_path",
        });
      },
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
      validateToolPath(_toolId, executablePath) {
        return Effect.succeed({
          displayLabel: "Saved path",
          path: executablePath,
          sourceCategory: "provided_path",
        });
      },
    };
    const githubCli = createGithubCliAdapter(systemCommands);
    const dependencies: GithubCommandDependencies = {
      githubCli,
      resolveGithubCommand: () => Effect.succeed({ ghCommand: "gh", githubCli }),
      systemCommands,
      toolDiscovery,
    };

    const pullRequest = await Effect.runPromise(
      findGithubPullRequestForBranch(
        dependencies,
        "/repo",
        { host: "github.com", owner: "Maxsky5", name: "openducktor" },
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

describe("GitHub provider selection", () => {
  test("does not resolve GitHub dependencies for another configured provider", async () => {
    let resolveGithubCommandCalls = 0;
    const dependencies: GithubRepositoryDependencies = {
      githubCli: {
        readVersion: () => Effect.die("GitHub CLI must not be read"),
        run: () => Effect.die("GitHub CLI must not run"),
      },
      resolveGithubCommand() {
        resolveGithubCommandCalls += 1;
        return Effect.die("GitHub dependencies must not be resolved");
      },
      // SAFETY: The provider mismatch must return before any Git operation is read.
      gitPort: {} as GitPort,
      // SAFETY: The provider mismatch must return before any command operation is read.
      systemCommands: {} as SystemCommandPort,
      // SAFETY: The provider mismatch must return before any tool discovery operation is read.
      toolDiscovery: {} as ToolDiscoveryPort,
    };
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {
        provider: {
          id: "gitlab",
          enabled: true,
          autoDetected: false,
          repository: { host: "gitlab.com", owner: "acme", name: "widget" },
        },
      },
    });

    const readResult = await Effect.runPromiseExit(
      requireGithubPullRequestReadRepository(dependencies, "/repo", repoConfig),
    );
    const syncPolicy = await Effect.runPromise(
      githubPullRequestSyncPolicy(dependencies, repoConfig),
    );

    expect(readResult._tag).toBe("Failure");
    expect(syncPolicy).toEqual({ providerId: "github", available: false });
    expect(resolveGithubCommandCalls).toBe(0);
  });
});
