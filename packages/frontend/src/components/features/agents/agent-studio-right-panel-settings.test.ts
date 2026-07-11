import { describe, expect, test } from "bun:test";
import { buildDevServerSettingsOpenTarget } from "./agent-studio-right-panel-settings";

describe("buildDevServerSettingsOpenTarget", () => {
  test("targets the panel repository Scripts dev-server editor", () => {
    expect(buildDevServerSettingsOpenTarget("/repo")).toEqual({
      repositoryPath: "/repo",
      repositorySection: "scripts",
      anchor: "dev-servers",
    });
    expect(buildDevServerSettingsOpenTarget(null).repositoryPath).toBeNull();
  });
});
