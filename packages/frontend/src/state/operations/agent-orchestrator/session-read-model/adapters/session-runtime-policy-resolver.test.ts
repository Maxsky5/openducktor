import { expect, mock, test } from "bun:test";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { loadSessionRuntimePolicyResolver } from "./session-runtime-policy-resolver";

test("resolves OpenCode policy without loading settings", async () => {
  const loadSettingsSnapshot = mock(async () => createSettingsSnapshotFixture());
  const resolvePolicy = await loadSessionRuntimePolicyResolver({
    runtimeKinds: ["opencode"],
    loadSettingsSnapshot,
  });

  expect(resolvePolicy({ runtimeKind: "opencode", sessionScope: null })).toEqual({
    kind: "opencode",
  });
  expect(loadSettingsSnapshot).not.toHaveBeenCalled();
});

test("resolves Claude policy without loading settings", async () => {
  const loadSettingsSnapshot = mock(async () => createSettingsSnapshotFixture());
  const resolvePolicy = await loadSessionRuntimePolicyResolver({
    runtimeKinds: ["claude"],
    loadSettingsSnapshot,
  });

  expect(resolvePolicy({ runtimeKind: "claude", sessionScope: null })).toEqual({
    kind: "claude",
  });
  expect(loadSettingsSnapshot).not.toHaveBeenCalled();
});

test("loads settings inside the runtime-policy adapter for Codex policy", async () => {
  const loadSettingsSnapshot = mock(async () => createSettingsSnapshotFixture());
  const resolvePolicy = await loadSessionRuntimePolicyResolver({
    runtimeKinds: ["codex"],
    loadSettingsSnapshot,
  });

  expect(
    resolvePolicy({
      runtimeKind: "codex",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    }),
  ).toMatchObject({ kind: "codex" });
  expect(loadSettingsSnapshot).toHaveBeenCalledTimes(1);
});
