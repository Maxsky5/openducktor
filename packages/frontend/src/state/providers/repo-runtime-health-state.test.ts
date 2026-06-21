import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { buildRepoRuntimeHealthByRuntime } from "./repo-runtime-health-state";

describe("buildRepoRuntimeHealthByRuntime", () => {
  test("does not synthesize disabled runtime health while runtime settings are loading", () => {
    const runtimeHealthByRuntime = buildRepoRuntimeHealthByRuntime({
      checkedRuntimeHealthByRuntime: {},
      allRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      availableRuntimeDefinitions: [],
      isLoadingRuntimeDefinitions: true,
      runtimeDefinitionsError: null,
    });

    expect(runtimeHealthByRuntime).toEqual({});
  });

  test("does not synthesize disabled runtime health when runtime settings failed to load", () => {
    const runtimeHealthByRuntime = buildRepoRuntimeHealthByRuntime({
      checkedRuntimeHealthByRuntime: {},
      allRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      availableRuntimeDefinitions: [],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: "settings unavailable",
    });

    expect(runtimeHealthByRuntime).toEqual({});
  });

  test("marks unavailable definitions disabled after runtime settings settle", () => {
    const opencodeHealth = createRepoRuntimeHealthFixture({ status: "ready" });
    const runtimeHealthByRuntime = buildRepoRuntimeHealthByRuntime({
      checkedRuntimeHealthByRuntime: { opencode: opencodeHealth },
      allRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
    });

    expect(runtimeHealthByRuntime.opencode).toBe(opencodeHealth);
    expect(runtimeHealthByRuntime.codex?.status).toBe("disabled");
  });
});
