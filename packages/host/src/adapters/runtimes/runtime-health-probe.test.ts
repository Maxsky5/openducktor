import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPathOptions } from "../system/tool-discovery";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { createRuntimeHealthProbe } from "./runtime-health-probe";

const missingSystemCommands: SystemCommandPort = {
  requiredCommandError(command) {
    return Effect.succeed(
      `Required command \`${command}\` not found. Install ${command} and ensure it is available on PATH.`,
    );
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
    const probe = createMissingProbe({ homeDir: "/missing/home", platform: "linux" });

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain("opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY");
    expect(health.error).toContain(
      "standard install locations (/missing/home/.opencode/bin/opencode)",
    );
    expect(health.error).toContain("PATH");
    expect(health.error).toContain("Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.");
  });

  test("reports unhealthy OpenCode status when version probing fails", async () => {
    const systemCommands: SystemCommandPort = {
      ...missingSystemCommands,
      resolveCommandPath(command) {
        return Effect.succeed(command === "opencode" ? "/usr/local/bin/opencode" : null);
      },
      requiredCommandError() {
        return Effect.succeed(null);
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
  });
});
