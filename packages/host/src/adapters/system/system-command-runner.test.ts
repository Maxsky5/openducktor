import { describe, expect, spyOn, test } from "bun:test";
import { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
import { causeToHostBoundaryError, HostOperationError } from "../../effect/host-errors";
import type { SystemCommandRunOptions } from "../../ports/system-command-port";
import { createSystemCommandRunner } from "./system-command-runner";

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-system-command-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createSystemCommandRunner", () => {
  for (const path of ["timeout", "interruption", "overflow"] as const) {
    test(`awaits process and stream closure after ${path}`, async () => {
      const originalEmit = ChildProcess.prototype.emit;
      let child: ChildProcess | undefined;
      let closed = false;
      let ready!: () => void;
      const readiness = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const script =
        "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{process.stdout.write('x');process.stderr.write('y')},10);setTimeout(()=>process.exit(0),4000)";
      const spy = spyOn(ChildProcess.prototype, "emit").mockImplementation(function (
        this: ChildProcess,
        event: string | symbol,
        ...args: unknown[]
      ) {
        const result = originalEmit.call(this, event, ...args);
        if (event !== "spawn") return result;
        // Capture the native child for process-death assertions and emergency teardown.
        // oxlint-disable-next-line typescript/no-this-alias
        child = this;
        this.once("close", () => {
          closed = true;
        });
        this.stdout?.once("data", () => ready());
        return result;
      });
      const options: SystemCommandRunOptions = { timeoutMs: path === "timeout" ? 300 : 3000 };
      if (path === "overflow") options.maxStdoutBytes = 8;
      const fiber = Effect.runFork(
        createSystemCommandRunner().runCommandAllowFailure(
          process.execPath,
          ["-e", script],
          options,
        ),
      );
      try {
        await readiness;
        if (path === "interruption") await Effect.runPromise(Fiber.interrupt(fiber));
        const exit = await Effect.runPromise(Fiber.await(fiber));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(closed).toBe(true);
        expect(child?.stdout?.destroyed).toBe(true);
        expect(child?.stderr?.destroyed).toBe(true);
        expect(child?.stdout?.listenerCount("data")).toBe(0);
        expect(child?.stderr?.listenerCount("data")).toBe(0);
        expect(child?.listenerCount("error")).toBe(0);
        expect(child?.listenerCount("close")).toBe(0);
        expect(() => process.kill(child!.pid!, 0)).toThrow();
      } finally {
        child?.kill("SIGKILL");
        await Effect.runPromise(Fiber.interrupt(fiber));
        spy.mockRestore();
      }
    });
  }

  for (const failurePath of ["timeout", "overflow", "interruption"] as const) {
    test(`reports ${failurePath} and cleanup failure to the host caller`, async () => {
      const originalEmit = ChildProcess.prototype.emit;
      let child: ChildProcess | undefined;
      let ready!: () => void;
      const readiness = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const spy = spyOn(ChildProcess.prototype, "emit").mockImplementation(function (
        this: ChildProcess,
        event: string | symbol,
        ...args: unknown[]
      ) {
        const result = originalEmit.call(this, event, ...args);
        if (event !== "spawn") return result;
        // Capture the native child for process-death assertions and emergency teardown.
        // oxlint-disable-next-line typescript/no-this-alias
        child = this;
        this.kill = () => false;
        this.stdout?.once("data", () => ready());
        return result;
      });
      try {
        const options: SystemCommandRunOptions = {
          timeoutMs: failurePath === "timeout" ? 100 : 3000,
        };
        if (failurePath === "overflow") options.maxStdoutBytes = 8;
        const effectRouter = createEffectHostCommandRouter({
          handlers: {
            system_get_platform: () =>
              createSystemCommandRunner()
                .runCommandAllowFailure(
                  process.execPath,
                  [
                    "-e",
                    "process.stdout.write('ready');setInterval(()=>{process.stdout.write('x');process.stderr.write('y')},10);setTimeout(()=>process.exit(0),4000)",
                  ],
                  options,
                )
                .pipe(Effect.as("darwin")),
          },
        });
        let error: unknown;
        if (failurePath === "interruption") {
          const fiber = Effect.runFork(effectRouter.invoke("system_get_platform"));
          await readiness;
          await Effect.runPromise(Fiber.interrupt(fiber));
          const exit = await Effect.runPromise(Fiber.await(fiber));
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            error = causeToHostBoundaryError(exit.cause);
          }
        } else {
          error = await toPromiseHostCommandRouter(effectRouter)
            .invoke("system_get_platform")
            .then(
              () => null,
              (cause: unknown) => cause,
            );
        }
        expect(error).toBeInstanceOf(HostOperationError);
        if (error instanceof HostOperationError) {
          const expected =
            failurePath === "timeout"
              ? "Timed out running"
              : failurePath === "overflow"
                ? "more than 8 bytes"
                : "interrupted";
          expect(error.message).toContain(expected);
          expect(error.message).toContain("Failed to stop command");
          expect(error.details).toMatchObject({ command: process.execPath });
          if (failurePath === "timeout") {
            expect(error.operation).toBe("systemCommand.runCommandAllowFailure");
            expect(error.details).toMatchObject({ timeoutMs: 100 });
          }
        }
        expect(child?.stdout?.destroyed).toBe(true);
        expect(child?.stderr?.destroyed).toBe(true);
        expect(child?.stderr?.listenerCount("data")).toBe(0);
      } finally {
        if (child) ChildProcess.prototype.kill.call(child, "SIGKILL");
        spy.mockRestore();
      }
    });
  }

  test("returns binary stdout as base64 and stops oversized output", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => process.env,
      platform: process.platform,
    });
    const args = ["-e", "process.stdout.write(Buffer.from([0, 255, 128, 1]))"];
    const result = await Effect.runPromise(
      port.runCommandAllowFailure("bun", args, { stdoutEncoding: "base64", maxStdoutBytes: 4 }),
    );
    expect(result.stdout).toBe(Buffer.from([0, 255, 128, 1]).toString("base64"));
    await expect(
      Effect.runPromise(
        port.runCommandAllowFailure("bun", args, { stdoutEncoding: "base64", maxStdoutBytes: 3 }),
      ),
    ).rejects.toThrow("more than 3 bytes");
  });

  test("preserves a nonzero process exit code", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => process.env,
      platform: process.platform,
    });

    const result = await Effect.runPromise(
      port.runCommandAllowFailure("bun", ["-e", "process.exit(8)"]),
    );

    expect(result).toMatchObject({ ok: false, exitCode: 8 });
  });

  test("passes the explicit environment to spawned commands", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => ({
        PATH: process.env.PATH,
        OPENDUCKTOR_TEST_VALUE: "from-host-env",
      }),
      platform: process.platform,
    });

    const result = await Effect.runPromise(
      port.runCommandAllowFailure("bun", ["-e", "console.log(process.env.OPENDUCKTOR_TEST_VALUE)"]),
    );

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("from-host-env");
  });

  test("per-command environment overrides inherited values", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => ({
        PATH: process.env.PATH,
        FORCE_COLOR: "1",
        CLICOLOR_FORCE: "1",
        NO_COLOR: "0",
      }),
      platform: process.platform,
    });

    const result = await Effect.runPromise(
      port.runCommandAllowFailure(
        "bun",
        [
          "-e",
          "console.log([process.env.FORCE_COLOR, process.env.CLICOLOR_FORCE, process.env.NO_COLOR].join('|'))",
        ],
        {
          env: {
            FORCE_COLOR: "0",
            CLICOLOR_FORCE: "0",
            NO_COLOR: "1",
          },
        },
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("0|0|1");
  });

  test("disables terminal color for version reads", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => ({
        PATH: process.env.PATH,
        CLICOLOR: "1",
        CLICOLOR_FORCE: "1",
        FORCE_COLOR: "1",
        NO_COLOR: "0",
      }),
      platform: process.platform,
    });

    const version = await Effect.runPromise(
      port.versionCommand("bun", ["-e", "console.log(JSON.stringify(process.env))"], {
        env: {
          FORCE_COLOR: "1",
          NO_COLOR: "0",
          OPENDUCKTOR_VERSION_TEST: "kept",
        },
      }),
    );

    expect(JSON.parse(version ?? "{}")).toMatchObject({
      CLICOLOR: "0",
      CLICOLOR_FORCE: "0",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      OPENDUCKTOR_VERSION_TEST: "kept",
    });
  });

  test("fails before spawn when command discovery cannot resolve the executable", async () => {
    const port = createSystemCommandRunner({
      readEnv: () => ({ PATH: "" }),
      platform: "linux",
    });

    await expect(
      Effect.runPromise(port.runCommandAllowFailure("missing-tool", [])),
    ).rejects.toThrow("Command missing-tool not found.");
  });

  test.skipIf(process.platform === "win32")(
    "reads the environment for each command, so a later PATH applies",
    async () => {
      let env: NodeJS.ProcessEnv = { PATH: "" };
      const port = createSystemCommandRunner({ readEnv: () => env, platform: process.platform });

      const before = await Effect.runPromise(port.resolveCommandPath("sh"));
      env = { PATH: "/bin:/usr/bin" };
      const after = await Effect.runPromise(port.resolveCommandPath("sh"));

      expect(before).toBeNull();
      expect(after).toMatch(/\/sh$/);
    },
  );

  test("runs Windows cmd and bat launchers with arguments on native Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const toolDir = join(root, "tool dir");
      await mkdir(toolDir);
      const cmd = join(toolDir, "echo-tool.cmd");
      const bat = join(toolDir, "echo-bat.bat");
      await writeFile(cmd, "@echo off\r\necho cmd:%~1:%~2\r\n");
      await writeFile(bat, "@echo off\r\necho bat:%~1:%~2\r\n");

      const port = createSystemCommandRunner({
        readEnv: () => ({ PATH: toolDir, PATHEXT: ".CMD;.BAT", ComSpec: process.env.ComSpec }),
        platform: "win32",
      });

      const cmdResult = await Effect.runPromise(
        port.runCommandAllowFailure("echo-tool", ["one", "two words"]),
      );
      const batResult = await Effect.runPromise(
        port.runCommandAllowFailure("echo-bat", ["alpha", "beta words"]),
      );

      expect(cmdResult.ok).toBe(true);
      expect(cmdResult.stdout.trim()).toBe("cmd:one:two words");
      expect(batResult.ok).toBe(true);
      expect(batResult.stdout.trim()).toBe("bat:alpha:beta words");
    });
  });

  test("round-trips Windows batch arguments containing cmd metacharacters on native Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const outputPath = join(root, "args.txt");
      const command = join(root, "print-args.cmd");
      await writeFile(
        command,
        [
          "@echo off",
          "setlocal DisableDelayedExpansion",
          'set "ARG1=%~1"',
          'set "ARG2=%~2"',
          'set "ARG3=%~3"',
          'set "ARG4=%~4"',
          'set "ARG5=%~5"',
          'set "ARG6=%~6"',
          'set "ARG7=%~7"',
          `> "${outputPath}" (`,
          "set ARG1",
          "set ARG2",
          "set ARG3",
          "set ARG4",
          "set ARG5",
          "set ARG6",
          "set ARG7",
          ")",
        ].join("\r\n"),
      );

      const port = createSystemCommandRunner({
        readEnv: () => ({ PATH: root, PATHEXT: ".CMD", ComSpec: process.env.ComSpec }),
        platform: "win32",
      });
      const args = [
        "two words",
        "percent=%APPDATA%",
        "amp=a&b",
        "pipe=a|b",
        "redir=a<b>c",
        "paren=(x)",
        "bang=a!b",
      ];

      const result = await Effect.runPromise(port.runCommandAllowFailure("print-args", args));

      expect(result.ok).toBe(true);
      expect(await readFile(outputPath, "utf8")).toContain(
        [
          "ARG1=two words",
          "ARG2=percent=%APPDATA%",
          "ARG3=amp=a&b",
          "ARG4=pipe=a|b",
          "ARG5=redir=a<b>c",
          "ARG6=paren=(x)",
          "ARG7=bang=a!b",
        ].join("\r\n"),
      );
    });
  });
});
