import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { persistedGlobalConfigV4Schema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { createWorkspaceSettingsService } from "./workspace-settings-service";

const withConfigFile = async (run: (configPath: string) => Promise<void>) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "odt-host-identity-"));
  try {
    await run(path.join(tempDir, "config.json"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

/** A new service on the same file, as after a host restart. */
const startHost = (configPath: string) =>
  createWorkspaceSettingsService(createSettingsConfigAdapter({ configPath }));

const readFileConfig = async (configPath: string) =>
  persistedGlobalConfigV4Schema.parse(JSON.parse(await readFile(configPath, "utf8")));

describe("host identity settings", () => {
  test("creates the host ID once and keeps it after a restart", async () => {
    await withConfigFile(async (configPath) => {
      const hostId = await Effect.runPromise(startHost(configPath).readHostId());
      expect(hostId).toMatch(/^[0-9a-f-]{36}$/);
      expect((await readFileConfig(configPath)).hostId).toBe(hostId);
      expect(await Effect.runPromise(startHost(configPath).readHostId())).toBe(hostId);
    });
  });

  test("gives one host ID to concurrent first reads", async () => {
    await withConfigFile(async (configPath) => {
      const service = startHost(configPath);
      const ids = await Effect.runPromise(
        Effect.all([service.readHostId(), service.readHostId()], { concurrency: "unbounded" }),
      );
      expect(ids[0]).toBe(ids[1]);
    });
  });

  test("keeps remote control settings after a restart", async () => {
    await withConfigFile(async (configPath) => {
      expect(await Effect.runPromise(startHost(configPath).readRemoteAccessSettings())).toEqual({
        enabled: false,
        configuration: null,
      });
      const settings = {
        enabled: true,
        configuration: { listenHost: "192.168.1.9", listenPort: 14328 },
      };
      await Effect.runPromise(startHost(configPath).saveRemoteAccessSettings(settings));
      expect(await Effect.runPromise(startHost(configPath).readRemoteAccessSettings())).toEqual(
        settings,
      );
      expect((await readFileConfig(configPath)).remoteAccess).toEqual(settings);
    });
  });

  test("keeps the other settings when it saves remote control", async () => {
    await withConfigFile(async (configPath) => {
      const service = startHost(configPath);
      await Effect.runPromise(service.setTheme("dark"));
      const hostId = await Effect.runPromise(service.readHostId());
      await Effect.runPromise(
        service.saveRemoteAccessSettings({
          enabled: false,
          configuration: { listenHost: "10.0.0.4", listenPort: 51_234 },
        }),
      );
      const saved = await readFileConfig(configPath);
      expect(saved.theme).toBe("dark");
      expect(saved.hostId).toBe(hostId);
    });
  });

  test("refuses a saved listener without a fixed port", async () => {
    await withConfigFile(async (configPath) => {
      const service = startHost(configPath);
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
