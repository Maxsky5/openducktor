import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type {
  SystemCommandPort,
  SystemCommandRunOptions,
  SystemCommandRunResult,
} from "../../ports/system-command-port";
import { createGithubCliAdapter } from "./github-cli";

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
});
