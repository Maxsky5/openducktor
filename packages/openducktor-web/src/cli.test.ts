import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLauncherOptions, parseCliArgs } from "./cli";

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

  test("creates a fresh valid identity for each workspace launch", () => {
    const packageRoot = path.resolve("packages/openducktor-web");
    const first = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );
    const second = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );

    expect(first.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
    expect(second.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
    expect(second.developmentInstanceId).not.toBe(first.developmentInstanceId);
  });

  test("builds isolated workspace launcher options without reading process environment", () => {
    const packageRoot = path.resolve("packages/openducktor-web");
    const options = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );

    expect(options).toMatchObject({
      packageRoot,
      frontendPort: 0,
      backendPort: 0,
      workspaceMode: true,
      workspaceRoot: path.resolve(packageRoot, "../.."),
    });
    expect(options.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
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
  }, 1_000);

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
  }, 1_000);

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
  }, 1_000);
});
