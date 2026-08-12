import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPathOptions } from "../system/tool-discovery";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { createRuntimeHealthProbe } from "./runtime-health-probe";

const missingSystemCommands: SystemCommandPort = {
  resolveCommandPath() {
    return Effect.succeed(null);
  },
  versionCommand() {
    return Effect.succeed(null);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: false, stdout: "", stderr: "" });
  },
};
const createToolDiscovery = (
  systemCommands: SystemCommandPort,
  options: ToolDiscoveryPathOptions = {},
) =>
  createToolDiscoveryAdapter({
    env: {},
    options,
    systemCommands,
  });
const createMissingProbe = (options: ToolDiscoveryPathOptions = {}) =>
  createRuntimeHealthProbe(
    missingSystemCommands,
    createToolDiscovery(missingSystemCommands, options),
  );

describe("createRuntimeHealthProbe", () => {
  test("reports actionable missing OpenCode diagnostics", async () => {
    const probe = createMissingProbe({
      homeDir: "/missing/home",
      platform: "linux",
    });

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode", "/missing/opencode"));

    expect(health.ok).toBe(false);
    expect(health.executablePath).toBe("/missing/opencode");
    expect(health.error).toContain(
      "Saved OpenCode path points to a missing or non-executable file",
    );
  });

  test("reports unhealthy OpenCode status when version probing fails", async () => {
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command) {
        return Effect.succeed(command === "/usr/local/bin/opencode" ? command : null);
      },
    };
    const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("opencode", "/usr/local/bin/opencode"),
    );

    expect(health).toEqual({
      kind: "opencode",
      enabled: true,
      ok: false,
      executablePath: "/usr/local/bin/opencode",
      version: null,
      error: "Failed reading opencode --version from /usr/local/bin/opencode",
    });
  });

  test("probes OpenCode version with non-interactive config and default command timeout", async () => {
    const calls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command) {
        return Effect.succeed(command === "/usr/local/bin/opencode" ? command : null);
      },
      versionCommand(...input) {
        calls.push(input);
        return Effect.succeed("1.16.2");
      },
    };
    const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("opencode", "/usr/local/bin/opencode"),
    );

    expect(health.ok).toBe(true);
    expect(calls).toEqual([
      [
        "/usr/local/bin/opencode",
        ["--version"],
        {
          env: { OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}' },
          timeoutMs: 10_000,
        },
      ],
    ]);
  });

  test("reports actionable missing Codex diagnostics", async () => {
    const probe = createMissingProbe({
      applicationsDir: "/missing/Applications",
      homeDir: "/missing/home",
      platform: "darwin",
    });

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex", "/missing/codex"));

    expect(health.ok).toBe(false);
    expect(health.executablePath).toBe("/missing/codex");
    expect(health.error).toContain("Saved Codex path points to a missing or non-executable file");
  });

  test("probes Claude Code through tool discovery", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openducktor-claude-health-"));
    const executablePath = join(tempDir, "claude");
    const calls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command, options) {
        if (options?.searchPath) {
          return Effect.succeed(null);
        }
        if (command === executablePath) {
          return Effect.succeed(executablePath);
        }
        return Effect.succeed(null);
      },
      versionCommand(...input) {
        calls.push(input);
        return Effect.succeed("0.3.191");
      },
    };
    try {
      await writeFile(executablePath, "claude-sdk-binary");
      await chmod(executablePath, 0o755);
      const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

      const health = await Effect.runPromise(probe.getRuntimeHealth("claude", executablePath));

      expect(health).toEqual({
        kind: "claude",
        enabled: true,
        ok: true,
        executablePath,
        version: "0.3.191",
        error: null,
      });
      expect(calls).toEqual([[executablePath, ["--version"], { timeoutMs: 10_000 }]]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("reports missing Claude Code executable through tool discovery", async () => {
    const probe = createRuntimeHealthProbe(
      missingSystemCommands,
      createToolDiscovery(missingSystemCommands),
    );

    const health = await Effect.runPromise(probe.getRuntimeHealth("claude", "/missing/claude"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain(
      "Saved Claude Code path points to a missing or non-executable file",
    );
  });
});
