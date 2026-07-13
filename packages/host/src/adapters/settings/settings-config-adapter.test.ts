import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createSettingsConfigAdapter } from "./settings-config-adapter";

describe("settings config adapter", () => {
  test("keeps concurrent atomic writes on distinct temp paths", async () => {
    const testDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-settings-"));
    const adapter = createSettingsConfigAdapter({
      configPath: path.join(testDirectory, "config.json"),
    });
    const configs = Array.from({ length: 50 }, (_, index) => ({
      ...createDefaultGlobalConfig(),
      theme: index % 2 === 0 ? ("dark" as const) : ("light" as const),
    }));

    try {
      await Effect.runPromise(
        Effect.all(
          configs.map((config) => adapter.writeConfig(config)),
          { concurrency: "unbounded" },
        ),
      );

      const savedConfig = await Effect.runPromise(adapter.readConfig());
      expect(savedConfig).not.toBeNull();
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  });
});
