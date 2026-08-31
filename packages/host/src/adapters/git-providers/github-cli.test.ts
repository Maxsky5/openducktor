import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type {
  SystemCommandPort,
  SystemCommandRunOptions,
  SystemCommandRunResult,
} from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createGithubCliAdapter, createGithubCommandResolver } from "./github-cli";

type RunCall = {
  command: string;
  args: string[];
  options: SystemCommandRunOptions | undefined;
};

type VersionCall = RunCall;

const createSystemCommandPort = ({
  runResult = { ok: true, stdout: "{}", stderr: "" },
  versionResult = "gh version 2.95.0",
}: {
  runResult?: SystemCommandRunResult;
  versionResult?: string | null;
} = {}) => {
  const runCalls: RunCall[] = [];
  const versionCalls: VersionCall[] = [];
  const port: SystemCommandPort = {
    resolveCommandPath(command) {
      return Effect.succeed(command);
    },
    versionCommand(command, args, options) {
      versionCalls.push({ command, args, options });
      return Effect.succeed(versionResult);
    },
    runCommandAllowFailure(command, args, options) {
      runCalls.push({ command, args, options });
      return Effect.succeed(runResult);
    },
  };

  return { port, runCalls, versionCalls };
};

describe("createGithubCliAdapter", () => {
  test("reads the API user for the requested host", async () => {
    const { port, runCalls } = createSystemCommandPort({
      runResult: {
        ok: true,
        stdout: "active-user\n",
        stderr: "",
      },
    });
    const githubCli = createGithubCliAdapter(port);

    const auth = await Effect.runPromise(
      githubCli.getAuth("/usr/local/bin/gh", "github.example.com"),
    );

    expect(auth).toEqual({
      authenticated: true,
      account: "active-user",
      reason: null,
    });
    expect(runCalls[0]).toMatchObject({
      command: "/usr/local/bin/gh",
      args: ["api", "user", "--hostname", "github.example.com", "--jq", ".login"],
    });
  });

  test("run preserves command options and enforces machine-readable env", async () => {
    const { port, runCalls } = createSystemCommandPort();
    const githubCli = createGithubCliAdapter(port);

    await Effect.runPromise(
      githubCli.run("gh", ["api", "repos/openai/openducktor/pulls"], {
        cwd: "/repo",
        env: {
          FORCE_COLOR: "1",
          CLICOLOR_FORCE: "1",
          CUSTOM_TOKEN: "kept",
        },
        timeoutMs: 1234,
      }),
    );

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]).toEqual({
      command: "gh",
      args: ["api", "repos/openai/openducktor/pulls"],
      options: {
        cwd: "/repo",
        env: {
          CUSTOM_TOKEN: "kept",
          GH_PROMPT_DISABLED: "1",
          NO_COLOR: "1",
          CLICOLOR: "0",
          CLICOLOR_FORCE: "0",
          FORCE_COLOR: "0",
        },
        timeoutMs: 1234,
      },
    });
  });

  test("readVersion uses the same machine-readable env", async () => {
    const { port, versionCalls } = createSystemCommandPort();
    const githubCli = createGithubCliAdapter(port);

    await Effect.runPromise(
      githubCli.readVersion("gh", {
        env: {
          FORCE_COLOR: "1",
          CUSTOM_PATH: "/bin",
        },
      }),
    );

    expect(versionCalls).toEqual([
      {
        command: "gh",
        args: ["--version"],
        options: {
          env: {
            CUSTOM_PATH: "/bin",
            GH_PROMPT_DISABLED: "1",
            NO_COLOR: "1",
            CLICOLOR: "0",
            CLICOLOR_FORCE: "0",
            FORCE_COLOR: "0",
          },
        },
      },
    ]);
  });

  test("resolves the configured GitHub CLI", async () => {
    const { port } = createSystemCommandPort();
    const githubCli = createGithubCliAdapter(port);
    const calls: string[] = [];
    const toolDiscovery: ToolDiscoveryPort = {
      discoverTool: () => Effect.dieMessage("Unexpected discoverTool call"),
      resolveTool: () => Effect.dieMessage("Unexpected resolveTool call"),
      resolveToolPath: (toolId) => {
        calls.push(toolId);
        return Effect.succeed("/usr/local/bin/gh");
      },
      validateToolPath: () => Effect.dieMessage("Unexpected validateToolPath call"),
    };

    const command = await Effect.runPromise(
      createGithubCommandResolver({ githubCli, toolDiscovery }).resolve(),
    );

    expect(command).toEqual({ ghCommand: "/usr/local/bin/gh", githubCli });
    expect(calls).toEqual(["githubCli"]);
  });
});
