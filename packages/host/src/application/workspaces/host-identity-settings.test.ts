import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { hostPreferencesSchema } from "../../config/global-config";
import type { SharedSettingsDatabase } from "../../ports/settings-config-port";
import { createSharedSettingsFixture } from "../../test-support/shared-settings-fixture";
import { createWorkspaceSettingsService } from "./workspace-settings-service";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";

const withConfigFile = async (
  run: (configPath: string, sharedSettings: SharedSettingsDatabase) => Promise<void>,
) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "odt-host-identity-"));
  const configPath = path.join(tempDir, "config.json");
  const fixture = await createSharedSettingsFixture({ configPath });
  try {
    await run(configPath, fixture.database);
  } finally {
    await fixture.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  }
};

const startHost = (configPath: string, sharedSettings: SharedSettingsDatabase) =>
  createWorkspaceSettingsService(
    createSettingsConfigAdapter({ configPath, sharedSettings }),
    builtinTaskWorkflows,
  );

const readFileConfig = async (configPath: string) =>
  hostPreferencesSchema.parse(JSON.parse(await readFile(configPath, "utf8")));

describe("host remote control settings", () => {
  test("keeps remote control settings after a restart", async () => {
    await withConfigFile(async (configPath, sharedSettings) => {
      expect(
        await Effect.runPromise(startHost(configPath, sharedSettings).readRemoteAccessSettings()),
      ).toEqual({
        enabled: false,
        configuration: null,
      });
      const settings = {
        enabled: true,
        configuration: { listenHost: "192.168.1.9", listenPort: 14328 },
      };
      await Effect.runPromise(
        startHost(configPath, sharedSettings).saveRemoteAccessSettings(settings),
      );
      expect(
        await Effect.runPromise(startHost(configPath, sharedSettings).readRemoteAccessSettings()),
      ).toEqual(settings);
      expect((await Effect.runPromise(sharedSettings.readConfig()))?.remoteAccess).toEqual(
        settings,
      );
    });
  });

  test("keeps the other settings when it saves remote control", async () => {
    await withConfigFile(async (configPath, sharedSettings) => {
      const service = startHost(configPath, sharedSettings);
      await Effect.runPromise(service.setTheme("dark"));
      await Effect.runPromise(
        service.saveRemoteAccessSettings({
          enabled: false,
          configuration: { listenHost: "10.0.0.4", listenPort: 51_234 },
        }),
      );
      const saved = await readFileConfig(configPath);
      expect(saved.theme).toBe("dark");
    });
  });

  test("refuses a saved listener without a fixed port", async () => {
    await withConfigFile(async (configPath, sharedSettings) => {
      const service = startHost(configPath, sharedSettings);
      const result = await Effect.runPromise(
        Effect.result(
          service.saveRemoteAccessSettings({
            enabled: true,
            configuration: { listenHost: "192.168.1.9", listenPort: 0 },
          }),
        ),
      );
      expect(result._tag).toBe("Failure");
      expect(await Effect.runPromise(service.readRemoteAccessSettings())).toEqual({
        enabled: false,
        configuration: null,
      });
    });
  });
});
