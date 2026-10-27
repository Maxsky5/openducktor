import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { GitCommandRunner } from "./git-command-runner";
import { fetchRemote } from "./git-remote-fetch";

type RunnerCall = { args: string[]; env: Readonly<Record<string, string>> | undefined };

/** The Git config of the test repository, by lowercase key. */
type SshConfig = { "core.sshcommand"?: string; "ssh.variant"?: string };

const createRunner = (config: SshConfig) => {
  const calls: RunnerCall[] = [];
  const runner: GitCommandRunner = (_cwd, args, options) =>
    Effect.sync(() => {
      calls.push({ args, env: options?.env });
      if (args[0] === "config") {
        const lines = Object.entries(config).map(([key, value]) => `${key} ${value}\n`);
        // `git config --get-regexp` exits with 1 when no key matches.
        return lines.length === 0
          ? { ok: false, stdout: "", stderr: "", exitCode: 1 }
          : { ok: true, stdout: lines.join(""), stderr: "", exitCode: 0 };
      }
      return { ok: true, stdout: "", stderr: "", exitCode: 0 };
    });
  return { runner, calls };
};

const fetchEnv = async (env: NodeJS.ProcessEnv, config: SshConfig = {}) => {
  const { runner, calls } = createRunner(config);
  const output = await Effect.runPromise(fetchRemote(runner, env, "/repo", "origin"));
  const fetchCall = calls.find((call) => call.args[0] === "fetch");
  return { fetchCall, calls, output };
};

describe("remote fetch without prompts", () => {
  test("fetches every branch of the remote and turns off every credential prompt", async () => {
    const { fetchCall, output } = await fetchEnv({});

    expect(fetchCall?.args).toEqual([
      "fetch",
      "--prune",
      "--no-write-fetch-head",
      "--end-of-options",
      "origin",
    ]);
    expect(output).toBe("Fetched origin");
    expect(fetchCall?.env).toEqual({
      GIT_ASKPASS: "",
      GCM_INTERACTIVE: "never",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    });
  });

  test("keeps the SSH command that Git would use, in Git's order", async () => {
    const sshCommand = async (env: NodeJS.ProcessEnv, config: SshConfig = {}) =>
      (await fetchEnv(env, config)).fetchCall?.env?.GIT_SSH_COMMAND;
    const config = { "core.sshcommand": "ssh -p 2222" };

    expect(await sshCommand({ GIT_SSH_COMMAND: "ssh -i key", GIT_SSH: "/bin/plink" }, config)).toBe(
      "ssh -i key -o BatchMode=yes",
    );
    expect(await sshCommand({ GIT_SSH: "/bin/plink" }, config)).toBe(
      "ssh -p 2222 -o BatchMode=yes",
    );
    expect(await sshCommand({ GIT_SSH: "/opt/my ssh" })).toBe("'/opt/my ssh' -o BatchMode=yes");
  });

  test("stops the prompts with the option of the program variant", async () => {
    const sshCommand = async (env: NodeJS.ProcessEnv, config: SshConfig = {}) =>
      (await fetchEnv(env, config)).fetchCall?.env?.GIT_SSH_COMMAND;

    expect(await sshCommand({ GIT_SSH: "C:\\Program Files\\PuTTY\\plink.exe" })).toBe(
      "'C:\\Program Files\\PuTTY\\plink.exe' -batch",
    );
    expect(await sshCommand({}, { "core.sshcommand": '"/usr/bin/plink" -v' })).toBe(
      '"/usr/bin/plink" -v -batch',
    );
    // Git adds `-batch` itself for TortoisePlink, and a simple program takes no options.
    expect(await sshCommand({ GIT_SSH: "/opt/TortoisePlink.exe" })).toBe(
      "'/opt/TortoisePlink.exe'",
    );
    expect(await sshCommand({ GIT_SSH: "/opt/wrapper" }, { "ssh.variant": "simple" })).toBe(
      "'/opt/wrapper'",
    );
    expect(await sshCommand({ GIT_SSH: "/opt/wrapper", GIT_SSH_VARIANT: "putty" })).toBe(
      "'/opt/wrapper' -batch",
    );
    // Git maps an unknown variant name to ssh.
    expect(await sshCommand({ GIT_SSH: "/bin/plink", GIT_SSH_VARIANT: "openssh" })).toBe(
      "'/bin/plink' -o BatchMode=yes",
    );
  });

  test("an environment SSH command and variant need no config read", async () => {
    const { calls } = await fetchEnv({ GIT_SSH_COMMAND: "ssh", GIT_SSH_VARIANT: "ssh" });

    expect(calls.map((call) => call.args[0])).toEqual(["fetch"]);
  });

  test("a failed fetch names the remote and gives the Git output", async () => {
    const runner: GitCommandRunner = (_cwd, args) =>
      Effect.succeed(
        args[0] === "fetch"
          ? { ok: false, stdout: "", stderr: "Permission denied (publickey).", exitCode: 128 }
          : { ok: false, stdout: "", stderr: "", exitCode: 1 },
      );

    await expect(Effect.runPromise(fetchRemote(runner, {}, "/repo", "origin"))).rejects.toThrow(
      "git fetch origin failed: Permission denied (publickey).",
    );
  });
});
