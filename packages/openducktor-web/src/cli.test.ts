import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli";

describe("web CLI argument parsing", () => {
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

  test("rejects ports outside the TCP range", () => {
    const parseZeroPort = () => parseCliArgs(["--port", "0"]);
    expect(parseZeroPort).toThrow("Invalid --port value: 0");
    expect(parseZeroPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

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

  test("persists real launcher and host lifecycle logs through readiness and shutdown", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-web-launcher-"));
    const reservePort = (): number => {
      const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
      const port = server.port;
      server.stop(true);
      if (port === undefined) {
        throw new Error("Expected Bun to allocate a test port.");
      }
      return port;
    };
    const frontendPort = reservePort();
    const backendPort = reservePort();
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const subprocess = Bun.spawn(
      [
        process.execPath,
        cliPath,
        "--port",
        String(frontendPort),
        "--backend-port",
        String(backendPort),
      ],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          OPENDUCKTOR_CONFIG_DIR: configDirectory,
        },
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
        if (stdout.includes("OpenDucktor web is ready:")) {
          ready.resolve();
        }
      }
      stdout += decoder.decode();
    })();
    const stderrPromise = new Response(subprocess.stderr).text();

    try {
      let readyTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready.promise,
          new Promise<never>((_, reject) => {
            readyTimeout = setTimeout(
              () => reject(new Error("Web launcher did not become ready.")),
              15_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(readyTimeout);
      }
      subprocess.kill("SIGTERM");
      const exitCode = await subprocess.exited;
      await stdoutPump;
      const stderr = await stderrPromise;

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("log persistence failed");
      expect(stderr).not.toContain("OPENDUCKTOR_CONFIG_DIR");
      const logDirectory = path.join(configDirectory, "logs");
      const logFileName = (await readdir(logDirectory)).find(
        (name) => name.startsWith("openducktor-web-") && name.endsWith(".log"),
      );
      expect(logFileName).toBeDefined();
      if (!logFileName) {
        throw new Error("Expected the web launcher to create a daily log file.");
      }
      const persisted = await readFile(path.join(logDirectory, logFileName), "utf8");
      const launcherMessages = [
        "Starting OpenDucktor TypeScript host...",
        "Waiting for OpenDucktor TypeScript host readiness...",
        "Starting OpenDucktor frontend server...",
        "OpenDucktor web is ready:",
        "Stopping OpenDucktor web after SIGTERM...",
        "Stopping OpenDucktor frontend server...",
      ];
      for (const message of launcherMessages) {
        expect(stdout).toContain(message);
      }
      for (const message of [
        ...launcherMessages,
        "Shutting down OpenDucktor host services",
        "OpenDucktor host services stopped",
        "OpenDucktor web stopped.",
      ]) {
        expect(persisted).toContain(message);
      }
    } finally {
      subprocess.kill("SIGKILL");
      await subprocess.exited;
      await rm(configDirectory, { force: true, recursive: true });
    }
  }, 20_000);
});
