import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  assertRuntimeSupportsSelectedStartMode,
  requireSourceSessionRuntimeKind,
} from "./use-session-start-modal-runner";

const FORKLESS_RUNTIME = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  label: "Reuse Runtime",
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    sessionLifecycle: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
      supportedStartModes: ["fresh", "reuse"],
      supportsSessionFork: false,
      forkTargets: [],
    },
  },
} as RuntimeDescriptor;

describe("assertRuntimeSupportsSelectedStartMode", () => {
  test("accepts a runtime that supports the concrete selected start mode", () => {
    expect(() =>
      assertRuntimeSupportsSelectedStartMode({
        launchActionId: "build_pull_request_generation",
        role: "build",
        runtimeDescriptor: FORKLESS_RUNTIME,
        runtimeKind: FORKLESS_RUNTIME.kind,
        startMode: "reuse",
        taskId: "TASK-1",
      }),
    ).not.toThrow();
  });

  test("fails fast before launch when the selected runtime does not support the selected mode", () => {
    expect(() =>
      assertRuntimeSupportsSelectedStartMode({
        launchActionId: "build_pull_request_generation",
        role: "build",
        runtimeDescriptor: FORKLESS_RUNTIME,
        runtimeKind: FORKLESS_RUNTIME.kind,
        startMode: "fork",
        taskId: "TASK-1",
      }),
    ).toThrow(
      'Runtime "Reuse Runtime" does not support fork session starts for build_pull_request_generation. Select a compatible runtime or start mode.',
    );
  });

  test("requires an available runtime for concrete non-reuse starts", () => {
    expect(() =>
      assertRuntimeSupportsSelectedStartMode({
        launchActionId: "build_implementation_start",
        role: "build",
        runtimeDescriptor: null,
        runtimeKind: "missing-runtime" as unknown as RuntimeKind,
        startMode: "fresh",
        taskId: "TASK-2",
      }),
    ).toThrow(
      "Starting a build build_implementation_start session for TASK-2 requires a runtime that supports fresh session starts.",
    );
  });

  test("uses the source option runtime kind before selected model runtime kind", () => {
    expect(
      requireSourceSessionRuntimeKind({
        value: "session-1",
        label: "Reusable session",
        description: "Reusable session with runtime",
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toBe("opencode");
  });

  test("fails fast when a reusable session has no runtime kind", () => {
    expect(() =>
      requireSourceSessionRuntimeKind({
        value: "session-2",
        label: "Missing runtime session",
        description: "Reusable session without runtime",
        selectedModel: null,
      }),
    ).toThrow("Reusable session is missing a runtime kind.");
  });
});
