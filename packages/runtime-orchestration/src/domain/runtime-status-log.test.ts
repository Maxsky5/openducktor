import { describe, expect, test } from "bun:test";
import type { HostRuntimeStatus } from "@openducktor/contracts";
import { describeRuntimeStatusChange } from "./runtime-status-log";

const status = (overrides: Partial<HostRuntimeStatus>): HostRuntimeStatus => ({
  kind: "opencode",
  enabled: true,
  configuredExecutablePath: "opencode",
  effectiveExecutablePath: null,
  version: null,
  state: "disabled",
  trigger: "host_startup",
  runtimeId: null,
  startedAt: null,
  updatedAt: "2026-10-04T10:00:00.000Z",
  failure: null,
  revision: 1,
  ...overrides,
});

describe("describeRuntimeStatusChange", () => {
  test("logs a start at host startup, then the ready runtime", () => {
    expect(
      describeRuntimeStatusChange(undefined, status({ state: "starting" }), "OpenCode"),
    ).toEqual({ level: "info", message: "Starting the OpenCode runtime with opencode." });
    expect(
      describeRuntimeStatusChange(
        "starting",
        status({
          state: "ready",
          runtimeId: "runtime-1",
          effectiveExecutablePath: "/opt/homebrew/bin/opencode",
          version: "1.18.34",
        }),
        "OpenCode",
      ),
    ).toEqual({
      level: "info",
      message:
        "The OpenCode runtime runtime-1 is ready: /opt/homebrew/bin/opencode, version 1.18.34.",
    });
  });

  test("logs a disabled kind once at startup, and a stop after a running state", () => {
    const disabled = status({ enabled: false });
    expect(describeRuntimeStatusChange(undefined, disabled, "Codex")).toEqual({
      level: "info",
      message: "The Codex runtime is disabled in settings.",
    });
    expect(describeRuntimeStatusChange("disabled", disabled, "Codex")).toBeNull();
    expect(describeRuntimeStatusChange(undefined, status({}), "Codex")).toBeNull();
    expect(
      describeRuntimeStatusChange(
        "ready",
        status({ state: "stopping", runtimeId: "runtime-1" }),
        "Codex",
      ),
    ).toEqual({ level: "info", message: "Stopping the Codex runtime runtime-1." });
    expect(describeRuntimeStatusChange("stopping", disabled, "Codex")).toEqual({
      level: "info",
      message: "The Codex runtime stopped.",
    });
  });

  test("logs a failure as an error once", () => {
    const failed = status({
      state: "error",
      failure: {
        trigger: "host_startup",
        phase: "start",
        message: "Executable not found: opencode.",
        nextAction: "Set the executable path in Settings > Runtimes.",
        occurredAt: "2026-10-04T10:00:00.000Z",
      },
    });
    expect(describeRuntimeStatusChange("starting", failed, "OpenCode")).toEqual({
      level: "error",
      message:
        "The OpenCode runtime failed during start: Executable not found: opencode. Set the executable path in Settings > Runtimes.",
    });
    expect(describeRuntimeStatusChange("error", failed, "OpenCode")).toBeNull();
  });
});
