import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import { createGithubCli } from "./cli";
import { parseGithubPullListResponse, parseGithubPullResponse } from "./pull-request-model";
import { fetchGithubPullRequestByNumber, findGithubPullRequestForBranch } from "./pull-requests";

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

const githubCliForPayload = (payload: string) =>
  createGithubCli({
    systemCommands: {
      resolveCommandPath: (command) => Effect.succeed(command),
      versionCommand: () => Effect.succeed("gh version 2.95.0"),
      runCommandAllowFailure: () =>
        Effect.succeed({ ok: true, stdout: payload, stderr: "", exitCode: 0 }),
    },
    toolDiscovery: {
      discoverTool: () => Effect.die("unexpected discoverTool call"),
      resolveTool: () => Effect.die("unexpected resolveTool call"),
      resolveToolPath: () => Effect.succeed("gh"),
      validateToolPath: () => Effect.die("unexpected validateToolPath call"),
    },
  });

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
  test("preserves the field on malformed GitHub payloads", async () => {
    const malformed = { ...githubPullResponse, head: { ref: 42 } };

    const failure = await Effect.runPromise(
      findGithubPullRequestForBranch(
        githubCliForPayload(JSON.stringify([malformed])),
        "/repo",
        { host: "github.com", owner: "openai", name: "openducktor" },
        "odt/task-42",
        "open",
      ).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({ field: "head.ref" });
  });

  test("preserves the field when a pull request read returns malformed data", async () => {
    const malformed = { ...githubPullResponse, head: { ref: 42 } };

    const failure = await Effect.runPromise(
      fetchGithubPullRequestByNumber(
        githubCliForPayload(JSON.stringify(malformed)),
        "/repo",
        { host: "github.com", owner: "openai", name: "openducktor" },
        42,
      ).pipe(Effect.flip),
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

    const pullRequest = await Effect.runPromise(
      findGithubPullRequestForBranch(
        githubCli,
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
