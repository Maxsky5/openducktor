import { expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createTerminalCommandTracker } from "../../application/terminals/terminal-command-tracker";
import { TerminalScreenState } from "../../application/terminals/terminal-screen-state";
import {
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { TerminalPtyLaunchPlan } from "../../ports/terminal-pty-port";
import { prepareTerminalShell, type TerminalShell } from "./terminal-shell-integration";

for (const [name, config] of [
  ["bash", "default"],
  ["zsh", "default"],
  ["zsh", "custom directory"],
  ["zsh", "redirected directory"],
  ["zsh", "custom history"],
  ["zsh", "non-login"],
  ["fish", "default"],
] as const) {
  const shell = Bun.which(name);
  test.skipIf(process.platform === "win32" || shell === null)(
    `${name} (${config}) reports commands and keeps the user's shell setup`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), "odt-shell-hooks-test-"));
      const nonce = "test-command-source";
      const commands: Array<string | null> = [];
      const screen = new TerminalScreenState({ columns: 80, rows: 24 });
      screen.onOsc(
        633,
        createTerminalCommandTracker(nonce, (command) => commands.push(command)),
      );
      let output = "";
      let failure: Error | null = null;
      const detail = () => JSON.stringify({ commands, output, failure });
      let child: ChildProcess | undefined;
      let prepared: TerminalShell | undefined;
      let exited: Promise<void> | undefined;
      const dotdir =
        config === "custom directory" || config === "redirected directory"
          ? join(root, "shell's config")
          : root;
      const historyPath = join(
        config === "custom history" ? root : dotdir,
        config === "custom history" ? "saved commands" : ".zsh_history",
      );
      const args = config === "non-login" ? ["-i"] : ["-l", "-i"];
      const historyCommand = "echo saved-before-terminal";
      const zshrc = [
        'PROMPT="fixture> "',
        config === "custom history"
          ? 'HISTFILE="$HOME/saved commands"'
          : 'HISTFILE=${HISTFILE:-"${ZDOTDIR-$HOME}/.zsh_history"}',
        "HISTSIZE=1000",
        "SAVEHIST=1000",
        "setopt APPEND_HISTORY",
        "user_preexec() { print -r -- user-preexec; }",
        "user_precmd() { print -r -- user-precmd; }",
        "preexec_functions=(user_preexec)",
        "precmd_functions=(user_precmd)",
      ].join("\n");
      const bashrc = [
        'PS1="fixture> "',
        'PROMPT_COMMAND="printf user-prompt"',
        "trap 'printf user-debug' DEBUG",
      ].join("\n");
      try {
        await mkdir(dotdir, { recursive: true });
        await writeFile(historyPath, `${historyCommand}\n`);
        if (config === "redirected directory") {
          await writeFile(join(root, ".zshenv"), 'ZDOTDIR="$HOME/shell\'s config"\n');
        }
        await writeFile(join(dotdir, ".zshrc"), zshrc);
        await writeFile(join(dotdir, ".zprofile"), "print -r -- user-profile\n");
        await writeFile(
          join(dotdir, ".zlogin"),
          "print -r -- user-login\npreexec_functions=(user_preexec)\nprecmd_functions=(user_precmd)\n",
        );
        await writeFile(join(dotdir, ".zlogout"), "print -r -- user-logout\n");
        await writeFile(join(root, ".bashrc"), bashrc);
        await writeFile(join(root, ".bash_profile"), 'source "$HOME/.bashrc"\n');
        const inheritedEnv = { ...process.env };
        delete inheritedEnv.ZDOTDIR;
        if (config === "custom directory") inheritedEnv.ZDOTDIR = dotdir;
        const env = {
          ...inheritedEnv,
          HOME: root,
          HISTFILE: historyPath,
          TERM: "xterm-256color",
        };
        if (name === "zsh") {
          const plain = spawnSync(shell!, args, {
            cwd: root,
            env,
            input: "fc -ln 1\nexit\n",
            encoding: "utf8",
            timeout: 2000,
          });
          expect(plain.status).toBe(0);
          expect(plain.stdout).toContain(historyCommand);
        }
        prepared = await Effect.runPromise(
          prepareTerminalShell({
            shell: shell!,
            args,
            cwd: root,
            env,
            grid: { columns: 80, rows: 24 },
            commandNonce: nonce,
          }),
        );
        child = spawn(prepared.plan.shell, [...prepared.plan.args], {
          cwd: prepared.plan.cwd,
          env: prepared.plan.env,
          detached: true,
          stdio: "pipe",
        });
        const consume = (data: Buffer) => {
          output += data.toString();
          screen.write(data, () => {});
        };
        child.stdout!.on("data", consume);
        child.stderr!.on("data", consume);
        child.on("error", (error) => {
          failure = error;
        });
        exited = new Promise((resolve) => child!.once("close", () => resolve()));
        await waitUntil(() => commands.includes(null), detail);
        expect(commands.filter((command) => command !== null)).toEqual([]);

        if (name === "zsh") {
          commands.length = 0;
          child.stdin!.write('print -r -- "history-file:$HISTFILE"\nfc -ln 1\n');
          await waitUntil(() => commands.includes("fc -ln 1") && commands.at(-1) === null, detail);
          expect(output).toContain(`history-file:${historyPath}`);
          expect(output).toContain(historyCommand);
        }

        child.stdin!.write("sleep 0.1\n");
        await waitUntil(() => commands.includes("sleep 0.1") && commands.at(-1) === null, detail);

        commands.length = 0;
        child.stdin!.write("read -r reply\n");
        await waitUntil(() => commands.includes("read -r reply"), detail);
        expect(commands.at(-1)).toBe("read -r reply");
        child.stdin!.write("answer\n");
        await waitUntil(() => commands.at(-1) === null, detail);

        commands.length = 0;
        const text = "printf 'héllo; 世界\\n'";
        child.stdin!.write(`${text}\n`);
        await waitUntil(() => commands.includes(text) && commands.at(-1) === null, detail);

        if (name === "zsh") {
          expect(output).toContain("user-preexec");
          expect(output).toContain("user-precmd");
          if (config === "non-login") {
            expect(output).not.toContain("user-profile");
            expect(output).not.toContain("user-login");
          } else {
            expect(output).toContain("user-profile");
            expect(output).toContain("user-login");
          }
        } else if (name === "bash") {
          expect(output).toContain("user-prompt");
          expect(output).toContain("user-debug");
        }
        expect(failure).toBeNull();
        expect(await readFile(join(dotdir, ".zshrc"), "utf8")).toBe(zshrc);
        expect(await readFile(join(root, ".bashrc"), "utf8")).toBe(bashrc);
        if (name === "zsh") {
          child.stdin!.end("exit\n");
          await exited;
          if (config !== "non-login") expect(output).toContain("user-logout");
          const reopened = spawnSync(shell!, args, {
            cwd: root,
            env,
            input: "fc -ln 1\nexit\n",
            encoding: "utf8",
            timeout: 2000,
          });
          expect(reopened.status).toBe(0);
          expect(reopened.stdout).toContain(historyCommand);
          expect(reopened.stdout).toContain(text);
        }
      } finally {
        if (child?.pid) {
          const runningChild = child;
          let closed = child.exitCode !== null || child.signalCode !== null;
          child.once("close", () => {
            closed = true;
          });
          await Effect.runPromise(
            terminateProcessTree({
              pid: child.pid,
              label: "shell hooks test",
              isClosed: () => closed,
              waitForExit: (timeoutMs) =>
                waitForChildProcessClose(runningChild, () => closed, timeoutMs),
              stopTimeoutMs: 100,
            }),
          );
        }
        await exited;
        if (prepared) await Effect.runPromise(prepared.dispose);
        await screen.drained();
        screen.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    // Real shell startup, command completion, and process-tree cleanup run in this test.
    5000,
  );
}

test("removes temporary startup files and leaves unsupported shells unchanged", async () => {
  const plan: TerminalPtyLaunchPlan = {
    shell: "/bin/bash",
    args: ["-l"],
    cwd: tmpdir(),
    env: {},
    grid: { columns: 80, rows: 24 },
    commandNonce: "source",
  };
  const prepared = await Effect.runPromise(prepareTerminalShell(plan));
  const script = prepared.plan.args[1]!;
  expect(await Bun.file(script).exists()).toBe(true);
  await Effect.runPromise(prepared.dispose);
  expect(await Bun.file(script).exists()).toBe(false);
  const unsupported = { ...plan, shell: "/bin/unsupported" };
  expect((await Effect.runPromise(prepareTerminalShell(unsupported))).plan).toBe(unsupported);
});

async function waitUntil(check: () => boolean, detail?: () => string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check() && Date.now() < deadline) await Bun.sleep(5);
  if (!check()) throw new Error(detail?.() ?? "Shell command state did not change");
}
