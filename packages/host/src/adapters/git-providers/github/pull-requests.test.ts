import { describe, expect, test } from "bun:test";
import {
  repoConfigSchema,
  type PullRequest,
  type TaskApprovalContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import { createGithubCli } from "./cli";
import { parseGithubPullListResponse, parseGithubPullResponse } from "./pull-request-model";
import { createGithubPullRequestProviderPort } from "./pull-requests";

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

const githubCliForPayload = (payload: string, calls: string[][] = []) =>
  createGithubCli({
    systemCommands: {
      resolveCommandPath: (command) => Effect.succeed(command),
      versionCommand: () => Effect.succeed("gh version 2.95.0"),
      runCommandAllowFailure: (_command, args) =>
        Effect.sync(() => {
          calls.push(args);
          return { ok: true, stdout: payload, stderr: "", exitCode: 0 };
        }),
    },
    toolDiscovery: {
      discoverTool: () => Effect.die("unexpected discoverTool call"),
      resolveTool: () => Effect.die("unexpected resolveTool call"),
      resolveToolPath: () => Effect.succeed("gh"),
      validateToolPath: () => Effect.die("unexpected validateToolPath call"),
    },
  });

const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  git: {
    provider: {
      id: "github",
      enabled: true,
      repository: { host: "github.com", owner: "openai", name: "openducktor" },
    },
  },
});

const repositoryPort: GitProviderRepositoryPort = {
  detectRepository: () => Effect.dieMessage("unexpected repository detection"),
  getRepository: () => Effect.succeed({ host: "github.com", owner: "openai", name: "openducktor" }),
  getMapping: () =>
    Effect.succeed({
      repository: { host: "github.com", owner: "openai", name: "openducktor" },
      remoteName: "publish",
    }),
};

const approvalContext = (pullRequest?: PullRequest): TaskApprovalContext => {
  const context: TaskApprovalContext = {
    taskId: "task-42",
    taskStatus: "human_review",
    workingDirectory: "/worktrees/repo/task-42",
    sourceBranch: "odt/task-42",
    targetBranch: { branch: "main" },
    defaultMergeMethod: "merge_commit",
    hasUncommittedChanges: false,
    uncommittedFileCount: 0,
    providers: [],
  };
  if (pullRequest !== undefined) {
    context.pullRequest = pullRequest;
  }
  return context;
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

describe("GitHub Pull Request capability failures", () => {
  test("preserves the field on malformed GitHub payloads", async () => {
    const malformed = { ...githubPullResponse, head: { ref: 42 } };

    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify([malformed])),
      repositoryPort,
    });

    const failure = await Effect.runPromise(
      port.findOpenForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({ field: "head.ref" });
  });

  test("preserves the field when a pull request read returns malformed data", async () => {
    const malformed = { ...githubPullResponse, head: { ref: 42 } };

    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify(malformed)),
      repositoryPort,
    });

    const failure = await Effect.runPromise(
      port.getByNumber({ repoConfig, number: 42 }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({ field: "head.ref" });
  });

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
      discoverTool: () => Effect.die("Unexpected discoverTool call"),
      resolveTool: () => Effect.die("Unexpected resolveTool call"),
      resolveToolPath: () => Effect.succeed("gh"),
      validateToolPath: () => Effect.die("Unexpected validateToolPath call"),
    };
    const githubCli = createGithubCli({ systemCommands, toolDiscovery });

    const port = createGithubPullRequestProviderPort({ githubCli, repositoryPort });

    const pullRequest = await Effect.runPromise(
      port.findOpenForSourceBranch({ repoConfig, sourceBranch: "odt/task-1" }),
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

describe("createGithubPullRequestProviderPort", () => {
  test("finds the latest merged pull request for a source branch", async () => {
    const older = {
      ...githubPullResponse,
      number: 41,
      state: "closed",
      merged_at: "2026-05-02T09:00:00Z",
      updated_at: "2026-05-02T09:00:00Z",
    };
    const latest = {
      ...githubPullResponse,
      number: 42,
      state: "closed",
      merged_at: "2026-05-02T10:00:00Z",
    };
    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify([latest, older])),
      repositoryPort,
    });

    const pullRequest = await Effect.runPromise(
      port.findLatestMergedForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }),
    );

    expect(pullRequest?.record.number).toBe(42);
    expect(pullRequest?.record.state).toBe("merged");
  });

  test("resolves the matching remote used to publish the task branch", async () => {
    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload("[]"),
      repositoryPort,
    });

    await expect(Effect.runPromise(port.resolvePublishRemote({ repoConfig }))).resolves.toBe(
      "publish",
    );
  });

  test("rejects refresh for a linked pull request from another provider", async () => {
    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify(githubPullResponse)),
      repositoryPort,
    });

    const failure = await Effect.runPromise(
      port
        .refresh({
          repoConfig,
          linkedPullRequest: {
            providerId: "gitlab",
            number: 42,
            url: "https://gitlab.example.com/openai/openducktor/-/merge_requests/42",
            state: "open",
            createdAt: "2026-05-01T10:00:00Z",
            updatedAt: "2026-05-02T10:00:00Z",
          },
        })
        .pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({ field: "pullRequest.providerId" });
  });

  test("creates a pull request with provider-private GitHub arguments", async () => {
    const calls: string[][] = [];
    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify(githubPullResponse), calls),
      repositoryPort,
    });

    const pullRequest = await Effect.runPromise(
      port.upsert({
        repoConfig,
        approval: approvalContext(),
        title: "  Task 42  ",
        body: "Task body",
      }),
    );

    expect(pullRequest.number).toBe(42);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        "--method",
        "POST",
        "head=odt/task-42",
        "base=main",
        "title=Task 42",
        "body=Task body",
      ]),
    );
  });

  test("updates an existing editable pull request", async () => {
    const calls: string[][] = [];
    const port = createGithubPullRequestProviderPort({
      githubCli: githubCliForPayload(JSON.stringify(githubPullResponse), calls),
      repositoryPort,
    });

    await Effect.runPromise(
      port.upsert({
        repoConfig,
        approval: approvalContext({
          providerId: "github",
          number: 42,
          url: githubPullResponse.html_url,
          state: "draft",
          createdAt: githubPullResponse.created_at,
          updatedAt: githubPullResponse.updated_at,
        }),
        title: "Task 42",
        body: "Updated body",
      }),
    );

    expect(calls[0]).toEqual(
      expect.arrayContaining([
        "--method",
        "PATCH",
        "repos/openai/openducktor/pulls/42",
        "title=Task 42",
        "body=Updated body",
      ]),
    );
    expect(calls[0]).not.toContain("head=odt/task-42");
    expect(calls[0]).not.toContain("base=main");
  });
});
