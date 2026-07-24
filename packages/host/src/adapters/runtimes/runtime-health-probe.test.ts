import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain("opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY");
    expect(health.error).toContain("standard install directories (/missing/home/.opencode/bin)");
    expect(health.error).toContain("PATH");
    expect(health.error).toContain("Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.");
  });

  test("reports unhealthy OpenCode status when version probing fails", async () => {
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command) {
        return Effect.succeed(command === "opencode" ? "/usr/local/bin/opencode" : null);
      },
    };
    const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode"));

    expect(health).toEqual({
      kind: "opencode",
      enabled: true,
      ok: false,
      version: null,
      error: "Failed reading opencode --version from /usr/local/bin/opencode",
    });
  });

  test("probes OpenCode version with non-interactive config and default command timeout", async () => {
    const calls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command) {
        return Effect.succeed(command === "opencode" ? "/usr/local/bin/opencode" : null);
      },
      versionCommand(...input) {
        calls.push(input);
        return Effect.succeed("1.16.2");
      },
    };
    const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode"));

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

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain("codex not found. Checked OPENDUCKTOR_CODEX_BINARY");
    expect(health.error).toContain(
      "standard install locations (/missing/Applications/Codex.app/Contents/Resources/codex, /missing/home/Applications/Codex.app/Contents/Resources/codex)",
    );
    expect(health.error).toContain("PATH");
    expect(health.error).toContain("Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.");
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
        if (command === "claude") {
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
      const probe = createRuntimeHealthProbe(systemCommands, createToolDiscovery(systemCommands));

      const health = await Effect.runPromise(probe.getRuntimeHealth("claude"));

      expect(health).toEqual({
        kind: "claude",
        enabled: true,
        ok: true,
        version: `0.3.191 (${executablePath})`,
        error: null,
      });
      expect(calls).toEqual([[executablePath, ["--version"], { timeoutMs: 2_000 }]]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("reports missing Claude Code executable through tool discovery", async () => {
    const probe = createRuntimeHealthProbe(
      missingSystemCommands,
      createToolDiscovery(missingSystemCommands),
    );

    const health = await Effect.runPromise(probe.getRuntimeHealth("claude"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain("claude not found. Checked OPENDUCKTOR_CLAUDE_BINARY");
    expect(health.error).toContain("Install Claude Code");
  });
});
