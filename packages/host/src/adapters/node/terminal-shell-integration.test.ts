import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

for (const name of ["bash", "zsh", "fish"]) {
  const shell = Bun.which(name);
  test.skipIf(process.platform === "win32" || shell === null)(
    `${name} reports silent commands and builtins, clears completed commands, and keeps user hooks`,
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
      const zshrc = [
        'PROMPT="fixture> "',
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
        await writeFile(join(root, ".zshrc"), zshrc);
        await writeFile(join(root, ".bashrc"), bashrc);
        await writeFile(join(root, ".bash_profile"), 'source "$HOME/.bashrc"\n');
        prepared = await Effect.runPromise(
          prepareTerminalShell({
            shell: shell!,
            args: ["-l", "-i"],
            cwd: root,
            env: { ...process.env, HOME: root, ZDOTDIR: root, TERM: "xterm-256color" },
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
        } else if (name === "bash") {
          expect(output).toContain("user-prompt");
          expect(output).toContain("user-debug");
        }
        expect(failure).toBeNull();
        expect(await readFile(join(root, ".zshrc"), "utf8")).toBe(zshrc);
        expect(await readFile(join(root, ".bashrc"), "utf8")).toBe(bashrc);
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
