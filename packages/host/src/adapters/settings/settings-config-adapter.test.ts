import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  createDefaultGlobalConfig,
  upgradePersistedGlobalConfigV2,
} from "../../config/global-config";
import { HostValidationError } from "../../effect/host-errors";
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
  test("uses the explicit config directory instead of the environment", async () => {
    await withTempConfig(async (configPath) => {
      const otherDir = join(configPath, "..", "other");
      const adapter = createSettingsConfigAdapter({
        configDir: join(configPath, ".."),
        environment: { OPENDUCKTOR_CONFIG_DIR: otherDir },
        initializeConfig: () => Effect.succeed(createDefaultGlobalConfig()),
      });

      await Effect.runPromise(adapter.readConfig());

      expect(await Bun.file(configPath).exists()).toBe(true);
      expect(await Bun.file(join(otherDir, "config.json")).exists()).toBe(false);
    });
  });

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

  test("reads version 2 for diagnostics without initialization or a write", async () => {
    await withTempConfig(async (configPath) => {
      const payload = JSON.stringify({
        version: 2,
        agentRuntimes: {
          opencode: { enabled: false },
          codex: { enabled: true },
          claude: { enabled: false },
        },
      });
      await writeFile(configPath, payload);
      let calls = 0;
      const adapter = createSettingsConfigAdapter({
        configPath,
        initializeConfig: () => {
          calls += 1;
          return Effect.succeed(createDefaultGlobalConfig());
        },
      });

      const config = await Effect.runPromise(adapter.readConfig({ initialize: false }));

      expect(config?.version).toBe(3);
      expect(config?.agentRuntimes.codex).toMatchObject({ enabled: true, executablePath: "" });
      expect(config?.agentRuntimes.opencode.enabled).toBe(false);
      expect(calls).toBe(0);
      expect(await readFile(configPath, "utf8")).toBe(payload);
    });
  });

  test("shares initialization failures and permits a later retry", async () => {
    await withTempConfig(async (configPath) => {
      let calls = 0;
      const adapter = createSettingsConfigAdapter({
        configPath,
        initializeConfig: () => {
          calls += 1;
          if (calls === 1) {
            return Effect.sleep("10 millis").pipe(
              Effect.zipRight(
                Effect.fail(new HostValidationError({ message: "Runtime discovery failed" })),
              ),
            );
          }
          return Effect.succeed(createDefaultGlobalConfig());
        },
      });

      const firstResults = await Effect.runPromise(
        Effect.all(
          [adapter.readConfig().pipe(Effect.either), adapter.readConfig().pipe(Effect.either)],
          { concurrency: "unbounded" },
        ),
      );

      expect(calls).toBe(1);
      expect(firstResults.map((result) => result._tag)).toEqual(["Left", "Left"]);

      const retried = await Effect.runPromise(adapter.readConfig());
      expect(calls).toBe(2);
      expect(retried?.version).toBe(3);
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

  test("reports an invalid config file with its path, the bad field, and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, JSON.stringify({ version: 3, theme: "blue" }));
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.either));
      if (result._tag !== "Left" || !(result.left instanceof HostValidationError)) {
        throw new Error("Expected a config validation failure");
      }

      expect(result.left.message).toBe(
        [
          `Invalid config file ${configPath}:`,
          'theme: Invalid option: expected one of "system"|"light"|"dark" (found "blue")',
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ].join("\n\n"),
      );
      expect(result.left.details).toEqual({ path: configPath });
    });
  });

  test("reports an unparsable config file with the path and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, "{ not json");
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.either));
      if (result._tag !== "Left") {
        throw new Error("Expected a config parse failure");
      }

      expect(result.left.message.startsWith(`Failed parsing config file ${configPath}:\n\n`)).toBe(
        true,
      );
      expect(
        result.left.message.endsWith(
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ),
      ).toBe(true);
    });
  });

  test("reports a config value that JSON cannot represent as a validation failure", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, '{"version": 3, "theme": 1e400}');
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.either));
      if (result._tag !== "Left" || !(result.left instanceof HostValidationError)) {
        throw new Error("Expected a config validation failure");
      }

      expect(result.left.message).toBe(
        [
          `Invalid config file ${configPath}:`,
          "config: Invalid input",
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ].join("\n\n"),
      );
      expect(result.left.message).not.toContain('"code"');
    });
  });

  test("round trips a legacy GitHub provider through only the canonical provider shape", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(
        configPath,
        JSON.stringify({
          version: 3,
          workspaces: {
            repo: {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              git: {
                providers: {
                  github: {
                    enabled: true,
                    autoDetected: true,
                    repository: {
                      host: "github.example.com",
                      owner: "open-ducktor",
                      name: "desktop",
                    },
                  },
                },
              },
            },
          },
        }),
      );
      const adapter = createSettingsConfigAdapter({ configPath });

      const config = await Effect.runPromise(adapter.readConfig());
      if (!config) throw new Error("Expected persisted config");
      await Effect.runPromise(adapter.writeConfig(config));

      expect(config.workspaces.repo?.git.provider).toEqual({
        id: "github",
        enabled: true,
        autoDetected: true,
        repository: {
          host: "github.example.com",
          owner: "open-ducktor",
          name: "desktop",
        },
      });
      const persisted = JSON.parse(await readFile(configPath, "utf8"));
      expect(persisted.workspaces.repo.git).toEqual(config.workspaces.repo?.git);
      expect(persisted.workspaces.repo.git).not.toHaveProperty("providers");
    });
  });
});
