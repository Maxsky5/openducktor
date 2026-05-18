import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
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

describe("createRuntimeHealthProbe", () => {
  test("reports actionable missing OpenCode diagnostics", async () => {
    const probe = createRuntimeHealthProbe(missingSystemCommands, {});

    const health = await Effect.runPromise(probe.getRuntimeHealth("opencode"));

    expect(health.ok).toBe(false);
    expect(health.error).toContain("opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY");
    expect(health.error).toContain("standard install location");
    expect(health.error).toContain("PATH");
    expect(health.error).toContain("Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.");
  });

  test("reports actionable missing Codex diagnostics", async () => {
    const probe = createRuntimeHealthProbe(missingSystemCommands, {});

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex"));

    expect(health.ok).toBe(false);
    expect(health.error).toBe(
      "codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled locations (OPENDUCKTOR_BUNDLED_BIN_DIR), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.",
    );
  });
});
