import { describe, expect, test } from "bun:test";
import { OPENDUCKTOR_DEV_INSTANCE_ENV } from "@openducktor/host";
import { electronPreviewEnvironment } from "./preview";

describe("Electron preview", () => {
  test("uses an isolated development profile outside Electron Node mode", () => {
    const env = electronPreviewEnvironment(
      {
        ELECTRON_RUN_AS_NODE: "1",
        OPENDUCKTOR_CONFIG_DIR: "/tmp/openducktor-preview-test",
        PATH: "/usr/bin",
      },
      process.cwd(),
    );

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.OPENDUCKTOR_CONFIG_DIR).toBe("/tmp/openducktor-preview-test");
    expect(env.PATH).toBe("/usr/bin");
    expect(env[OPENDUCKTOR_DEV_INSTANCE_ENV]).toMatch(/^electron-[a-f0-9]{12}$/u);
  });
});
