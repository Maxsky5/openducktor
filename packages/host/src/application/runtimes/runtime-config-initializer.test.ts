import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { parsePersistedGlobalConfigV2 } from "../../config/global-config";
import { createRuntimeConfigInitializer } from "./runtime-config-initializer";
import type { RuntimeExecutableCheckService } from "./runtime-executable-check-service";

const checkService: RuntimeExecutableCheckService = {
  check() {
    return Effect.succeed({
      runtimes: [
        {
          kind: "opencode",
          path: "/tools/opencode",
          ok: true,
          version: "1.0.0",
          error: null,
        },
        { kind: "codex", path: "", ok: false, version: null, error: "missing" },
        {
          kind: "claude",
          path: "/tools/claude",
          ok: true,
          version: "2.0.0",
          error: null,
        },
      ],
    });
  },
};

describe("runtime config initializer", () => {
  const initialize = createRuntimeConfigInitializer(checkService);

  test("enables only detected runtimes for a new config", async () => {
    const config = await Effect.runPromise(initialize(null));

    expect(config.agentRuntimes.opencode).toMatchObject({
      enabled: true,
      executablePath: "/tools/opencode",
    });
    expect(config.agentRuntimes.codex).toMatchObject({ enabled: false, executablePath: "" });
    expect(config.agentRuntimes.claude).toMatchObject({
      enabled: true,
      executablePath: "/tools/claude",
    });
  });

  test("preserves version 2 enabled choices while backfilling valid paths", async () => {
    const legacy = parsePersistedGlobalConfigV2({
      version: 2,
      agentRuntimes: {
        opencode: { enabled: false },
        codex: { enabled: true },
        claude: { enabled: false },
      },
    });
    const config = await Effect.runPromise(initialize(legacy));

    expect(config.agentRuntimes.opencode.enabled).toBe(false);
    expect(config.agentRuntimes.opencode.executablePath).toBe("/tools/opencode");
    expect(config.agentRuntimes.codex.enabled).toBe(true);
    expect(config.agentRuntimes.codex.executablePath).toBe("");
  });

  test("fails when discovery omits a known runtime", async () => {
    const incompleteInitializer = createRuntimeConfigInitializer({
      check() {
        return Effect.succeed({
          runtimes: [
            {
              kind: "opencode",
              path: "/tools/opencode",
              ok: true,
              version: "1.0.0",
              error: null,
            },
            { kind: "codex", path: "", ok: false, version: null, error: "missing" },
          ],
        });
      },
    });

    await expect(Effect.runPromise(incompleteInitializer(null))).rejects.toThrow(
      "Runtime discovery did not return a result for claude",
    );
  });
});
