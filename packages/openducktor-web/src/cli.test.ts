import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWebCliStopSignal } from "../scripts/dev";
import { parseCliArgs } from "./cli";

const waitForPersistedLogRecord = async (
  logFilePath: string,
  expectedRecord: string,
): Promise<void> => {
  const deadline = performance.now() + 2_000;
  while (true) {
    const persisted = await readFile(logFilePath, "utf8");
    if (persisted.includes(expectedRecord)) {
      return;
    }
    if (performance.now() >= deadline) {
      break;
    }
    await Bun.sleep(20);
  }
  throw new Error(`Web launcher did not persist ${JSON.stringify(expectedRecord)}.`);
};

describe("web CLI argument parsing", () => {
  test("uses OS-assigned ports for workspace development", () => {
    expect(parseCliArgs(["--workspace"])).toMatchObject({
      frontendPort: 0,
      backendPort: 0,
      workspaceMode: true,
    });
  });

  test("keeps fixed defaults for installed static launches", () => {
    expect(parseCliArgs([])).toMatchObject({
      frontendPort: 1420,
      backendPort: 14327,
      workspaceMode: false,
    });
  });

  test("parses explicit frontend and backend ports", () => {
    expect(parseCliArgs(["--port", "1421", "--backend-port", "14328"])).toMatchObject({
      frontendPort: 1421,
      backendPort: 14328,
    });
  });

  test("rejects malformed port values instead of truncating trailing text", () => {
    const parseBackendPort = () => parseCliArgs(["--backend-port", "14327abc"]);
    expect(parseBackendPort).toThrow("Invalid --backend-port value: 14327abc");
    expect(parseBackendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFrontendPort = () => parseCliArgs(["--port", "14.20"]);
    expect(parseFrontendPort).toThrow("Invalid --port value: 14.20");
    expect(parseFrontendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("accepts OS-assigned ports and rejects ports outside the TCP range", () => {
    expect(parseCliArgs(["--port", "0", "--backend-port", "0"])).toMatchObject({
      frontendPort: 0,
      backendPort: 0,
    });
    const parseTooLargeBackendPort = () => parseCliArgs(["--backend-port", "65536"]);
    expect(parseTooLargeBackendPort).toThrow("Invalid --backend-port value: 65536");
    expect(parseTooLargeBackendPort).toThrow(
      expect.objectContaining({ _tag: "WebValidationError" }),
    );
  });

  test("rejects missing option values and unknown options", () => {
    const parseMissingPort = () => parseCliArgs(["--port"]);
    expect(parseMissingPort).toThrow("Missing value for --port.");
    expect(parseMissingPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFlagAsPort = () => parseCliArgs(["--port", "--backend-port", "14328"]);
    expect(parseFlagAsPort).toThrow("Missing value for --port.");
    expect(parseFlagAsPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFlagAsBackendPort = () => parseCliArgs(["--backend-port", "--workspace"]);
    expect(parseFlagAsBackendPort).toThrow("Missing value for --backend-port.");
    expect(parseFlagAsBackendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseUnknownOption = () => parseCliArgs(["--unexpected"]);
    expect(parseUnknownOption).toThrow("Unknown option: --unexpected");
    expect(parseUnknownOption).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("exits non-zero when persistent logging cannot resolve its config directory", async () => {
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const subprocess = Bun.spawn([process.execPath, cliPath, "--workspace"], {
      env: {
        ...process.env,
        OPENDUCKTOR_CONFIG_DIR: "   ",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("OPENDUCKTOR_CONFIG_DIR");
  }, 5_000);

  test("prints help without initializing persistent logging", async () => {
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const subprocess = Bun.spawn([process.execPath, cliPath, "--help"], {
      env: {
        ...process.env,
        OPENDUCKTOR_CONFIG_DIR: "   ",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: openducktor-web [options]");
    expect(stderr).toBe("");
  }, 5_000);

  test("persists invalid option errors through the web logger", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-web-cli-error-"));
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    try {
      const subprocess = Bun.spawn([process.execPath, cliPath, "--unexpected"], {
        env: {
          ...process.env,
          NO_COLOR: "1",
          OPENDUCKTOR_CONFIG_DIR: configDirectory,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stderr).text(),
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} {2}ERROR Unknown option: --unexpected/m,
      );
      const logDirectory = path.join(configDirectory, "logs");
      const logFileName = (await readdir(logDirectory)).find(
        (name) => name.startsWith("openducktor-web-") && name.endsWith(".log"),
      );
      expect(logFileName).toBeDefined();
      if (!logFileName) {
        throw new Error("Expected invalid CLI input to create a web log file.");
      }
      const persisted = await readFile(path.join(logDirectory, logFileName), "utf8");
      expect(persisted).toContain("ERROR Unknown option: --unexpected");
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  }, 5_000);

  test("runs the workspace CLI without a development instance environment variable", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-web-launcher-"));
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const subprocessEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: "1",
      OPENDUCKTOR_CONFIG_DIR: configDirectory,
    };
    delete subprocessEnvironment.OPENDUCKTOR_DEV_INSTANCE;
    const subprocess = Bun.spawn(
      [process.execPath, cliPath, "--workspace", "--port", "0", "--backend-port", "0"],
      {
        env: subprocessEnvironment,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    let stdout = "";
    const ready = Promise.withResolvers<void>();
    const stdoutPump = (async () => {
      const decoder = new TextDecoder();
      const reader = subprocess.stdout.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = value;
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("Instance:")) {
          ready.resolve();
        }
      }
      stdout += decoder.decode();
    })();
    const stderrPromise = new Response(subprocess.stderr).text();
    const exited = subprocess.exited.then(async (exitCode) => ({
      exitCode,
      stderr: await stderrPromise,
    }));

    try {
      let readyTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const readiness = await Promise.race([
          ready.promise.then(() => ({ _tag: "ready" as const })),
          exited.then(({ exitCode, stderr }) => ({
            _tag: "exited" as const,
            exitCode,
            stderr,
          })),
          new Promise<never>((_, reject) => {
            readyTimeout = setTimeout(
              () => reject(new Error("Web launcher did not become ready.")),
              15_000,
            );
          }),
        ]);
        if (readiness._tag === "exited") {
          throw new Error(
            `Web launcher exited before readiness with code ${readiness.exitCode}.\n${readiness.stderr}`,
          );
        }
      } finally {
        clearTimeout(readyTimeout);
      }
      const instanceMatch = stdout.match(/Instance:\s+(browser-[a-f0-9]{12})/u);
      expect(instanceMatch).not.toBeNull();
      if (!instanceMatch) {
        throw new Error("Expected the workspace CLI to print its development instance ID.");
      }
      const developmentInstanceId = instanceMatch[1];
      if (!developmentInstanceId) {
        throw new Error("Expected the workspace CLI instance log to contain an ID.");
      }
      const discoveryPath = path.join(
        configDirectory,
        "runtime",
        "dev-instances",
        developmentInstanceId,
        "mcp-bridge.json",
      );
      await expect(readFile(discoveryPath, "utf8")).resolves.toContain('"hostUrl"');
      const logDirectory = path.join(configDirectory, "logs");
      const logFileName = (await readdir(logDirectory)).find(
        (name) => name.startsWith("openducktor-web-") && name.endsWith(".log"),
      );
      expect(logFileName).toBeDefined();
      if (!logFileName) {
        throw new Error("Expected the web launcher to create a daily log file.");
      }
      const logFilePath = path.join(logDirectory, logFileName);
      await waitForPersistedLogRecord(logFilePath, `Instance: ${developmentInstanceId}`);

      const shutdownSignal = resolveWebCliStopSignal();
      subprocess.kill(shutdownSignal);
      const { exitCode, stderr } = await exited;
      await stdoutPump;

      expect(exitCode).toBe(shutdownSignal === "SIGINT" ? 130 : 143);
      expect(stderr).not.toContain("log persistence failed");
      expect(stderr).not.toContain("OPENDUCKTOR_CONFIG_DIR");
      const persisted = await readFile(logFilePath, "utf8");
      const startupMessages = [
        "Starting OpenDucktor TypeScript host...",
        "Waiting for OpenDucktor TypeScript host readiness...",
        "Starting OpenDucktor frontend server...",
        "OpenDucktor web is ready:",
      ];
      for (const message of startupMessages) {
        expect(stdout).toContain(message);
        expect(persisted).toContain(message);
      }
      expect(stdout).toMatch(/Local:\s+http:\/\/localhost:\d+\//u);
      expect(stdout).toMatch(/Backend:\s+http:\/\/127\.0\.0\.1:\d+/u);
      expect(stdout).toMatch(/Instance:\s+browser-[a-f0-9]{12}/u);
      expect(persisted).toMatch(/Local:\s+http:\/\/localhost:\d+\//u);
      expect(persisted).toMatch(/Backend:\s+http:\/\/127\.0\.0\.1:\d+/u);
      expect(persisted).toMatch(/Instance:\s+browser-[a-f0-9]{12}/u);
      // Bun terminates Windows subprocesses without running this POSIX signal handler.
      if (process.platform !== "win32") {
        await expect(readFile(discoveryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        const shutdownConsoleMessages = [
          `Stopping OpenDucktor web after ${shutdownSignal}...`,
          "Stopping OpenDucktor frontend server...",
        ];
        for (const message of shutdownConsoleMessages) {
          expect(stdout).toContain(message);
        }
        expect(stdout).not.toContain("shutdown is already in progress");
        for (const message of [
          ...shutdownConsoleMessages,
          "Shutting down OpenDucktor host services",
          "OpenDucktor host services stopped",
          "OpenDucktor web stopped.",
        ]) {
          expect(persisted).toContain(message);
        }
      }
    } finally {
      subprocess.kill("SIGKILL");
      await subprocess.exited;
      await rm(configDirectory, { force: true, recursive: true });
    }
  }, 20_000);
});
