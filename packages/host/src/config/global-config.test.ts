import { describe, expect, test } from "bun:test";
import {
  createDefaultGlobalConfig,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  upgradePersistedGlobalConfigV2,
} from "./global-config";

describe("global config", () => {
  test("creates only current version 3 config", () => {
    const config = createDefaultGlobalConfig();

    expect(config.version).toBe(3);
    expect(config.agentRuntimes.opencode).toEqual({ enabled: false, executablePath: "" });
  });

  test("parses current and legacy versions through distinct entry points", () => {
    expect(parsePersistedGlobalConfig({ version: 3 }).version).toBe(3);
    expect(parsePersistedGlobalConfigV2({ version: 2 }).version).toBe(2);
    expect(() => parsePersistedGlobalConfig({ version: 2 })).toThrow(
      "Unsupported config version 2. Expected 3.",
    );
  });

  test("upgrades runtime paths without changing existing enabled choices", () => {
    const legacy = parsePersistedGlobalConfigV2({
      version: 2,
      agentRuntimes: {
        opencode: { enabled: false },
        codex: { enabled: true },
        claude: { enabled: true },
      },
    });

    const upgraded = upgradePersistedGlobalConfigV2(legacy, {
      opencode: "/tools/opencode",
      codex: "",
      claude: "/tools/claude",
    });

    expect(upgraded.version).toBe(3);
    expect(upgraded.agentRuntimes.opencode).toMatchObject({
      enabled: false,
      executablePath: "/tools/opencode",
    });
    expect(upgraded.agentRuntimes.codex).toMatchObject({ enabled: true, executablePath: "" });
    expect(upgraded.agentRuntimes.claude).toMatchObject({
      enabled: true,
      executablePath: "/tools/claude",
    });
  });
});
