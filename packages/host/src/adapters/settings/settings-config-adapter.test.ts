import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  createDefaultGlobalConfig,
  upgradePersistedGlobalConfigV2,
} from "../../config/global-config";
import { createSettingsConfigAdapter } from "./settings-config-adapter";

const withTempConfig = async (run: (configPath: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-settings-config-"));
  try {
    await run(join(root, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("settings config adapter initialization", () => {
  test("initializes and writes a missing config only once across concurrent reads", async () => {
    await withTempConfig(async (configPath) => {
      let calls = 0;
      const adapter = createSettingsConfigAdapter({
        configPath,
        initializeConfig: () => {
          calls += 1;
          return Effect.succeed({
            ...createDefaultGlobalConfig(),
            agentRuntimes: {
              ...createDefaultGlobalConfig().agentRuntimes,
              opencode: { enabled: true, executablePath: "/tools/opencode" },
            },
          });
        },
      });

      const configs = await Effect.runPromise(
        Effect.all([adapter.readConfig(), adapter.readConfig()], { concurrency: "unbounded" }),
      );

      expect(calls).toBe(1);
      expect(configs[0]?.agentRuntimes.opencode.executablePath).toBe("/tools/opencode");
      expect(JSON.parse(await readFile(configPath, "utf8")).version).toBe(3);
    });
  });

  test("upgrades version 2 and preserves enabled choices", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(
        configPath,
        JSON.stringify({
          version: 2,
          agentRuntimes: {
            opencode: { enabled: false },
            codex: { enabled: true },
            claude: { enabled: false },
          },
        }),
      );
      const adapter = createSettingsConfigAdapter({
        configPath,
        initializeConfig: (legacy) => {
          if (!legacy) return Effect.die("Expected legacy config");
          return Effect.succeed(
            upgradePersistedGlobalConfigV2(legacy, {
              opencode: "/tools/opencode",
              codex: "",
              claude: "",
            }),
          );
        },
      });

      const config = await Effect.runPromise(adapter.readConfig());

      expect(config?.version).toBe(3);
      expect(config?.agentRuntimes.opencode).toMatchObject({
        enabled: false,
        executablePath: "/tools/opencode",
      });
      expect(config?.agentRuntimes.codex.enabled).toBe(true);
    });
  });

  test("does not rerun initialization for version 3", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, JSON.stringify(createDefaultGlobalConfig()));
      let calls = 0;
      const adapter = createSettingsConfigAdapter({
        configPath,
        initializeConfig: () => {
          calls += 1;
          return Effect.succeed(createDefaultGlobalConfig());
        },
      });

      const config = await Effect.runPromise(adapter.readConfig());

      expect(config?.version).toBe(3);
      expect(calls).toBe(0);
    });
  });
});
