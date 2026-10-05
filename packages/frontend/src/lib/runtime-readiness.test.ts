import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
} from "@/test-utils/shared-test-fixtures";
import type { HostRuntimeStatusMap } from "@/types/diagnostics";
import {
  deriveRuntimeReadiness,
  inactiveRuntimeReadinessTarget,
  type RuntimeReadinessTarget,
  resolvingRuntimeReadinessTarget,
  runtimeReadinessTargetForRuntime,
} from "./runtime-readiness";

const runtimeDefinitions = [
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
];

const derive = ({
  statusByKind,
  target,
  hasWorkspace = true,
  runtimeStatus = {},
}: {
  statusByKind: HostRuntimeStatusMap;
  target: RuntimeReadinessTarget;
  hasWorkspace?: boolean;
  runtimeStatus?: Parameters<typeof createHostRuntimeStatusContextValue>[0];
}) =>
  deriveRuntimeReadiness({
    hasWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    runtimeStatus: createHostRuntimeStatusContextValue({ ...runtimeStatus, statusByKind }),
    runtimeTarget: target,
  });

describe("deriveRuntimeReadiness", () => {
  test("gates on the exact kind of the selected session", () => {
    const statusByKind = {
      opencode: createHostRuntimeStatusFixture({ kind: "opencode" }),
      codex: createHostRuntimeStatusFixture({ kind: "codex", state: "restarting" }),
    };

    expect(derive({ statusByKind, target: runtimeReadinessTargetForRuntime("opencode") })).toEqual({
      state: "ready",
      message: null,
    });
    expect(derive({ statusByKind, target: runtimeReadinessTargetForRuntime("codex") })).toEqual({
      state: "checking",
      message: "Codex runtime is restarting. Wait until it is ready.",
    });
  });

  test("blocks a disabled kind and a failed kind with the next action", () => {
    const statusByKind = {
      opencode: createHostRuntimeStatusFixture({
        kind: "opencode",
        state: "disabled",
        enabled: false,
      }),
      codex: createHostRuntimeStatusFixture({
        kind: "codex",
        state: "error",
        failure: {
          trigger: "host_startup",
          phase: "start",
          message: "Codex failed to start.",
          nextAction: "Fix the executable path in Settings.",
          occurredAt: "2026-02-22T08:00:00.000Z",
        },
      }),
    };

    expect(
      derive({ statusByKind, target: runtimeReadinessTargetForRuntime("opencode") }),
    ).toMatchObject({
      state: "blocked",
      message: "OpenCode runtime is disabled. Enable it in Settings > Runtimes.",
    });
    expect(
      derive({ statusByKind, target: runtimeReadinessTargetForRuntime("codex") }),
    ).toMatchObject({
      state: "blocked",
      message: "Codex failed to start. Fix the executable path in Settings.",
    });
  });

  test("does not treat ready state as current when live updates stopped", () => {
    const readiness = derive({
      statusByKind: { opencode: createHostRuntimeStatusFixture({ kind: "opencode" }) },
      target: runtimeReadinessTargetForRuntime("opencode"),
      runtimeStatus: { streamError: "Connection lost.", isCurrent: false },
    });

    expect(readiness.state).toBe("blocked");
    expect(readiness.message).toContain("Connection lost.");
  });

  test("waits while the baseline is not yet current", () => {
    expect(
      derive({
        statusByKind: { opencode: createHostRuntimeStatusFixture({ kind: "opencode" }) },
        target: runtimeReadinessTargetForRuntime("opencode"),
        runtimeStatus: { isCurrent: false },
      }),
    ).toMatchObject({ state: "checking", message: "Loading runtime status..." });
  });

  test("uses any ready kind when no kind is selected", () => {
    const statusByKind = {
      opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "error" }),
      claude: createHostRuntimeStatusFixture({ kind: "claude" }),
    };

    expect(derive({ statusByKind, target: runtimeReadinessTargetForRuntime(null) }).state).toBe(
      "ready",
    );
  });

  test("keeps resolving and inactive targets independent of runtime state", () => {
    expect(derive({ statusByKind: {}, target: resolvingRuntimeReadinessTarget }).state).toBe(
      "checking",
    );
    expect(derive({ statusByKind: {}, target: inactiveRuntimeReadinessTarget }).state).toBe(
      "ready",
    );
    expect(
      derive({
        statusByKind: {},
        target: inactiveRuntimeReadinessTarget,
        hasWorkspace: false,
      }).state,
    ).toBe("blocked");
  });
});
