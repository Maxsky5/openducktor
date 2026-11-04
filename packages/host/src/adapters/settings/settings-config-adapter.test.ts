import { withConfigCommit } from "../config/config-commit";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { settingsSnapshotSaveInputSchema } from "@openducktor/contracts";
import { saveSettingsSnapshot } from "../../test-support/save-settings-snapshot";
import { createSharedSettingsFixture } from "../../test-support/shared-settings-fixture";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createOpenCodeCreationSettings } from "../../application/workspaces/opencode-creation-settings";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  createDefaultGlobalConfig,
  toHostPreferences,
  upgradePersistedGlobalConfigV2,
} from "../../config/global-config";
import type { SharedSettingsDatabase } from "../../ports/settings-config-port";
import { SettingsFileError } from "../../effect/host-errors";
import { createSettingsConfigAdapter } from "./settings-config-adapter";
import { loadLegacySettingsConfig, readSettingsConfigFile } from "./settings-config-file";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const withTempConfig = async (run: (configPath: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-settings-config-"));
  try {
    await run(join(root, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("settings config files", () => {
  test("a shared write keeps a preference edit that another host saves during the write", async () => {
    await withTempConfig(async (configPath) => {
      const shared = createDefaultGlobalConfig();
      await writeFile(configPath, JSON.stringify(toHostPreferences(shared)));
      const unexpected = () => Effect.die(new Error("Unexpected shared settings read."));
      const sharedSettings: SharedSettingsDatabase = {
        readGlobalConfig: unexpected,
        readRepoConfig: unexpected,
        readRepoConfigByRepoPath: unexpected,
        readWorkspaceCatalogSnapshot: unexpected,
        readAutopilotSettings: unexpected,
        readConfig: unexpected,
        updateConfig: (change) =>
          Effect.promise(async () => {
            // Another host saves its theme while this write waits for the database lock.
            const preferences = JSON.parse(await readFile(configPath, "utf8"));
            await writeFile(configPath, JSON.stringify({ ...preferences, theme: "dark" }));
            return { current: shared, next: change(shared, []), changed: true };
          }),
      };
      const adapter = createSettingsConfigAdapter({ configPath, sharedSettings });

      const result = await Effect.runPromise(
        adapter.applyConfigChange(
          (current) => ({ ...current, chat: { ...current.chat, showThinkingMessages: true } }),
          [],
        ),
      );

      const saved = JSON.parse(await readFile(configPath, "utf8"));
      expect(saved.theme).toBe("dark");
      expect(saved.chat.showThinkingMessages).toBe(true);
      expect(result).toMatchObject({ preferences: "saved", config: { theme: "dark" } });
    });
  });

  test("round trips OpenCode rules through Settings and resolves detached role snapshots", async () => {
    await withTempConfig(async (configPath) => {
      const fixture = await createSharedSettingsFixture({ configPath });
      try {
        const adapter = fixture.settingsConfig;
        const service = createWorkspaceSettingsService(adapter, builtinTaskWorkflows);
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
        await Effect.runPromise(
          saveSettingsSnapshot(
            service,
            settingsSnapshotSaveInputSchema.parse({
              global: {
                agentRuntimes: {
                  opencode: {
                    defaults: { rules },
                    roleOverrides: {
                      create: {
                        qa: { rules: [{ permission: "myserver_*", pattern: "*", action: "deny" }] },
                      },
                    },
                  },
                },
              },
            }),
          ),
        );
        const restartedAdapter = createSettingsConfigAdapter({
          configPath,
          sharedSettings: fixture.database,
        });
        const restartedService = createWorkspaceSettingsService(
          restartedAdapter,
          builtinTaskWorkflows,
        );
        const loaded = await Effect.runPromise(restartedService.getSettingsSnapshot());
        expect(loaded.agentRuntimes.opencode).toEqual(draft.agentRuntimes.opencode);
        const resolver = createOpenCodeCreationSettings(restartedAdapter);
        const qa = await Effect.runPromise(
          resolver.resolve({
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task",
            role: "qa",
          }),
        );
        expect(qa).toEqual({
          defaults: rules,
          role: draft.agentRuntimes.opencode.roleOverrides.qa!.rules,
        });
        const repository = await Effect.runPromise(
          resolver.resolve({ kind: "repository", workspaceId: "workspace-1" }),
        );
        expect(repository).toEqual({ defaults: rules, role: [] });
        loaded.agentRuntimes.opencode.defaults.rules = [];
        loaded.agentRuntimes.opencode.executablePath = "/new/opencode";
        loaded.agentRuntimes.opencode.enabled = false;
        await Effect.runPromise(
          saveSettingsSnapshot(
            restartedService,
            settingsSnapshotSaveInputSchema.parse({
              global: {
                agentRuntimes: {
                  opencode: {
                    defaults: { rules: [] },
                    executablePath: "/new/opencode",
                    enabled: false,
                  },
                },
              },
            }),
          ),
        );
        expect(qa.defaults).toEqual(rules);
        const latest = await Effect.runPromise(
          resolver.resolve({
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task",
            role: "qa",
          }),
        );
        expect(latest.defaults).toEqual([]);
        expect(latest.role).toEqual(qa.role);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("scoped shared edits retain every other workspace preference", async () => {
    await withTempConfig(async (configPath) => {
      const config = createDefaultGlobalConfig();
      for (const id of ["one", "two"])
        config.workspaces[id] = repoConfigFixture({
          workspaceId: id,
          workspaceName: id,
          repoPath: `/${id}`,
          agentStudioState: { openTaskIds: [`${id}-task`] },
        });
      const fixture = await createSharedSettingsFixture({ configPath, config });
      try {
        const observed: string[][] = [];
        const adapter = withConfigCommit(fixture.settingsConfig, (config) =>
          Effect.sync(() => {
            observed.push(Object.keys(config.workspaces).sort());
          }),
        );
        await Effect.runPromise(
          adapter.updateConfig(
            (current) => {
              current.workspaces.one!.workspaceName = "Edited";
              current.workspaces.one!.agentStudioState.openTaskIds = [];
              return current;
            },
            ["one"],
          ),
        );
        await Effect.runPromise(
          adapter.updateConfig((current) => ({ ...current, theme: "dark" }), []),
        );
        const stored = await Effect.runPromise(adapter.readConfig());
        expect(stored?.workspaces.one?.workspaceName).toBe("Edited");
        expect(stored?.workspaces.one?.agentStudioState.openTaskIds).toEqual([]);
        expect(stored?.workspaces.two?.agentStudioState.openTaskIds).toEqual(["two-task"]);
        expect(stored?.theme).toBe("dark");
        expect(observed).toEqual([
          ["one", "two"],
          ["one", "two"],
        ]);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("rejects invalid persisted OpenCode rules with the exact field and a recovery action", async () => {
    await withTempConfig(async (configPath) => {
      const config = createDefaultGlobalConfig();
      config.agentRuntimes.opencode.roleOverrides.qa = {
        rules: [{ permission: "bash", pattern: " ", action: "ask" }],
      };
      await writeFile(configPath, JSON.stringify(config));
      await expect(Effect.runPromise(readSettingsConfigFile(configPath))).rejects.toThrow(
        "agentRuntimes.opencode.roleOverrides.qa.rules.0.pattern",
      );
      await expect(Effect.runPromise(readSettingsConfigFile(configPath))).rejects.toThrow(
        "Fix the values in this file",
      );
    });
  });

  test("discovers runtime paths for a version 2 import without changing its source JSON", async () => {
    await withTempConfig(async (configPath) => {
      const payload = JSON.stringify({
        version: 2,
        agentRuntimes: { opencode: { enabled: false } },
      });
      await writeFile(configPath, payload);
      let calls = 0;
      const initializeConfig: Parameters<typeof loadLegacySettingsConfig>[1] = (legacy) => {
        calls += 1;
        if (!legacy) return Effect.die("Expected version 2 settings");
        return Effect.succeed(
          upgradePersistedGlobalConfigV2(legacy, { opencode: "/tools/opencode" }),
        );
      };
      const config = await Effect.runPromise(
        loadLegacySettingsConfig(configPath, initializeConfig),
      );
      expect(config?.agentRuntimes.opencode).toMatchObject({
        enabled: false,
        executablePath: "/tools/opencode",
      });
      expect(calls).toBe(1);
      expect(await readFile(configPath, "utf8")).toBe(payload);
    });
  });

  test("discovers runtime paths for a new root import without creating config JSON", async () => {
    await withTempConfig(async (configPath) => {
      const initialized = createDefaultGlobalConfig();
      initialized.agentRuntimes.opencode.executablePath = "/tools/opencode";
      let calls = 0;
      const initializeConfig: Parameters<typeof loadLegacySettingsConfig>[1] = (legacy) => {
        calls += 1;
        expect(legacy).toBeNull();
        return Effect.succeed(initialized);
      };
      const config = await Effect.runPromise(
        loadLegacySettingsConfig(configPath, initializeConfig),
      );
      expect(config?.agentRuntimes.opencode.executablePath).toBe("/tools/opencode");
      expect(calls).toBe(1);
      await expect(readFile(configPath, "utf8")).rejects.toHaveProperty("code", "ENOENT");
    });
  });

  test("reports an invalid config file with its path, the bad field, and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, JSON.stringify({ version: 3, theme: "blue" }));

      const result = await Effect.runPromise(
        readSettingsConfigFile(configPath).pipe(Effect.result),
      );
      if (result._tag !== "Failure" || !(result.failure instanceof SettingsFileError)) {
        throw new Error("Expected a config validation failure");
      }

      expect(result.failure.message).toBe(
        [
          `Invalid config file ${configPath}:`,
          'theme: Invalid option: expected one of "system"|"light"|"dark" (found "blue")',
          "Fix the values in this file, or move it aside to reset OpenDucktor settings.",
        ].join("\n\n"),
      );
      expect(result.failure).toMatchObject({ reason: "invalid", path: configPath });
    });
  });

  test("reports an unparsable config file with the path and a recovery hint", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, "{ not json");

      const result = await Effect.runPromise(
        readSettingsConfigFile(configPath).pipe(Effect.result),
      );
      if (result._tag !== "Failure" || !(result.failure instanceof SettingsFileError)) {
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

        const result = await Effect.runPromise(
          readSettingsConfigFile(configPath).pipe(Effect.result),
        );

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure).toBeInstanceOf(SettingsFileError);
          expect(result.failure.message).toContain("extra:");
          expect(result.failure).toMatchObject({ reason: "invalid", path: configPath });
        }
        expect(await readFile(configPath, "utf8")).toBe(payload);
      });
    },
  );

  test("reports a config value that JSON cannot represent as a validation failure", async () => {
    await withTempConfig(async (configPath) => {
      await writeFile(configPath, '{"version": 3, "theme": 1e400}');

      const result = await Effect.runPromise(
        readSettingsConfigFile(configPath).pipe(Effect.result),
      );
      if (result._tag !== "Failure" || !(result.failure instanceof SettingsFileError)) {
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
});
