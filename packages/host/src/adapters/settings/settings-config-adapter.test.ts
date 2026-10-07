import { saveSettingsSnapshot } from "../../test-support/save-settings-snapshot";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createOpenCodeCreationSettings } from "../../application/workspaces/opencode-creation-settings";
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
import {
  createSettingsConfigAdapter,
  findInvalidSettingsFileError,
} from "./settings-config-adapter";

const withTempConfig = async (run: (configPath: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-settings-config-"));
  try {
    await run(join(root, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("settings config adapter initialization", () => {
  test("round trips OpenCode rules through Settings and resolves detached role snapshots", async () => {
    await withTempConfig(async (configPath) => {
      const adapter = createSettingsConfigAdapter({ configPath });
      const service = createWorkspaceSettingsService(adapter);
      const draft = await Effect.runPromise(service.getSettingsSnapshot());
      const rules = [
        { permission: "bash", pattern: "*", action: "deny" as const },
        { permission: "bash", pattern: "git ?  *", action: "allow" as const },
        { permission: "read", pattern: "~/private/*", action: "ask" as const },
      ];
      draft.agentRuntimes.opencode.defaults.rules = rules;
      draft.agentRuntimes.opencode.roleOverrides = {
        qa: { rules: [{ permission: "myserver_*", pattern: "*", action: "deny" }] },
      };
      await Effect.runPromise(saveSettingsSnapshot(service, draft));
      const restartedAdapter = createSettingsConfigAdapter({ configPath });
      const restartedService = createWorkspaceSettingsService(restartedAdapter);
      const loaded = await Effect.runPromise(restartedService.getSettingsSnapshot());
      expect(loaded.agentRuntimes.opencode).toEqual(draft.agentRuntimes.opencode);
      const resolver = createOpenCodeCreationSettings(restartedAdapter);
      const qa = await Effect.runPromise(
        resolver.resolve({ kind: "workflow", taskId: "task", role: "qa" }),
      );
      expect(qa).toEqual({
        defaults: rules,
        role: draft.agentRuntimes.opencode.roleOverrides.qa!.rules,
      });
      const repository = await Effect.runPromise(resolver.resolve({ kind: "repository" }));
      expect(repository).toEqual({ defaults: rules, role: [] });
      loaded.agentRuntimes.opencode.defaults.rules = [];
      loaded.agentRuntimes.opencode.executablePath = "/new/opencode";
      loaded.agentRuntimes.opencode.enabled = false;
      await Effect.runPromise(saveSettingsSnapshot(restartedService, loaded));
      expect(qa.defaults).toEqual(rules);
      const latest = await Effect.runPromise(
        resolver.resolve({ kind: "workflow", taskId: "task", role: "qa" }),
      );
      expect(latest.defaults).toEqual([]);
      expect(latest.role).toEqual(qa.role);
    });
  });

  test("rejects invalid persisted OpenCode rules with the exact field and a recovery action", async () => {
    await withTempConfig(async (configPath) => {
      const config = createDefaultGlobalConfig();
      config.agentRuntimes.opencode.roleOverrides.qa = {
        rules: [{ permission: "bash", pattern: " ", action: "ask" }],
      };
      await writeFile(configPath, JSON.stringify(config));
      const adapter = createSettingsConfigAdapter({ configPath });
      await expect(Effect.runPromise(adapter.readConfig())).rejects.toThrow(
        "agentRuntimes.opencode.roleOverrides.qa.rules.0.pattern",
      );
      await expect(
        Effect.runPromise(createOpenCodeCreationSettings(adapter).resolve({ kind: "repository" })),
      ).rejects.toThrow("Fix the values in this file");
    });
  });

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
              opencode: {
                defaults: { rules: [] },
                roleOverrides: {},
                enabled: true,
                executablePath: "/tools/opencode",
              },
            },
          });
        },
      });

      const configs = await Effect.runPromise(
        Effect.all([adapter.readConfig(), adapter.readConfig()], { concurrency: "unbounded" }),
      );

      expect(calls).toBe(1);
      expect(configs[0]?.agentRuntimes.opencode.executablePath).toBe("/tools/opencode");
      expect(JSON.parse(await readFile(configPath, "utf8")).version).toBe(4);
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

      expect(config?.version).toBe(4);
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

      expect(config?.version).toBe(4);
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
              Effect.andThen(
                Effect.fail(new HostValidationError({ message: "Runtime discovery failed" })),
              ),
            );
          }
          return Effect.succeed(createDefaultGlobalConfig());
        },
      });

      const firstResults = await Effect.runPromise(
        Effect.all(
          [adapter.readConfig().pipe(Effect.result), adapter.readConfig().pipe(Effect.result)],
          { concurrency: "unbounded" },
        ),
      );

      expect(calls).toBe(1);
      expect(firstResults.map((result) => result._tag)).toEqual(["Failure", "Failure"]);

      const retried = await Effect.runPromise(adapter.readConfig());
      expect(calls).toBe(2);
      expect(retried?.version).toBe(4);
    });
  });

  test("does not rerun initialization for the current config version", async () => {
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

      expect(config?.version).toBe(4);
      expect(calls).toBe(0);
    });
  });

  test("reports an invalid config file with its path, the bad field, and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, JSON.stringify({ version: 3, theme: "blue" }));
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.result));
      if (result._tag !== "Failure" || !(result.failure instanceof HostValidationError)) {
        throw new Error("Expected a config validation failure");
      }

      expect(result.failure.message).toBe(
        [
          `Invalid config file ${configPath}:`,
          'theme: Invalid option: expected one of "system"|"light"|"dark" (found "blue")',
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ].join("\n\n"),
      );
      expect(result.failure.details).toEqual({ kind: "invalid-settings-file", path: configPath });
      expect(findInvalidSettingsFileError({ cause: result.failure })).toBe(result.failure);
      expect(
        findInvalidSettingsFileError(new HostValidationError({ message: "Other failure" })),
      ).toBeNull();
    });
  });

  test("reports an unparsable config file with the path and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, "{ not json");
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.result));
      if (result._tag !== "Failure" || !(result.failure instanceof HostValidationError)) {
        throw new Error("Expected an invalid settings failure");
      }

      expect(
        result.failure.message.startsWith(`Invalid config file ${configPath}:\n\nInvalid JSON`),
      ).toBe(true);
      expect(
        result.failure.message.endsWith(
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ),
      ).toBe(true);
    });
  });

  test.each([2, 3, 4] as const)(
    "rejects unknown settings in version %i without changing the file",
    async (version) => {
      await withTempConfig(async (configPath) => {
        const payload = JSON.stringify({ version, theme: "dark", extra: true });
        await writeFile(configPath, payload);
        const adapter = createSettingsConfigAdapter({ configPath });

        const result = await Effect.runPromise(
          adapter.readConfig({ initialize: false }).pipe(Effect.result),
        );

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure).toBeInstanceOf(HostValidationError);
          expect(result.failure.message).toContain("extra:");
          expect(result.failure.details).toEqual({
            kind: "invalid-settings-file",
            path: configPath,
          });
        }
        expect(await readFile(configPath, "utf8")).toBe(payload);
      });
    },
  );

  test("reports a config value that JSON cannot represent as a validation failure", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, '{"version": 3, "theme": 1e400}');
      const adapter = createSettingsConfigAdapter({ configPath });

      const result = await Effect.runPromise(adapter.readConfig().pipe(Effect.result));
      if (result._tag !== "Failure" || !(result.failure instanceof HostValidationError)) {
        throw new Error("Expected a config validation failure");
      }

      expect(result.failure.message).toBe(
        [
          `Invalid config file ${configPath}:`,
          "config: Invalid input",
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ].join("\n\n"),
      );
      expect(result.failure.message).not.toContain('"code"');
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
