import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import {
  assertRuntimeSupportsSelectedStartMode,
  buildSessionStartModalDecision,
  requireSourceSessionRuntimeKind,
} from "./use-session-start-modal-runner";

const REQUEST_CONTEXT = {
  launchActionId: "build_pull_request_generation",
  role: "build",
  taskId: "TASK-1",
} as const;

const SELECTED_MODEL: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "high",
  profileId: "build-agent",
};

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

describe("buildSessionStartModalDecision", () => {
  test("builds a fresh decision with the selected model and no source session", () => {
    expect(
      buildSessionStartModalDecision({
        input: {
          startMode: "fresh",
          sourceExternalSessionId: null,
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toEqual({
      startMode: "fresh",
      selectedModel: SELECTED_MODEL,
    });
  });

  test("builds a reuse decision with the source session and optional target branch", () => {
    expect(
      buildSessionStartModalDecision({
        input: {
          startMode: "reuse",
          sourceExternalSessionId: "session-1",
          targetBranch: "refs/remotes/origin/feature/session-start",
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toEqual({
      startMode: "reuse",
      sourceExternalSessionId: "session-1",
      targetBranch: {
        remote: "origin",
        branch: "feature/session-start",
      },
    });
  });

  test("builds a fork decision with selected model, source session, and target branch", () => {
    expect(
      buildSessionStartModalDecision({
        input: {
          startMode: "fork",
          sourceExternalSessionId: "session-2",
          targetBranch: "refs/heads/local-review",
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toEqual({
      startMode: "fork",
      selectedModel: SELECTED_MODEL,
      sourceExternalSessionId: "session-2",
      targetBranch: {
        branch: "local-review",
      },
    });
  });

  test("keeps existing guard behavior for missing selected model and source session", () => {
    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "fresh",
          sourceExternalSessionId: null,
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires an explicit model selection.",
    );

    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "reuse",
          sourceExternalSessionId: null,
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires a source session.",
    );
  });

  test("keeps required guard errors ahead of invalid target branch parsing", () => {
    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "fresh",
          sourceExternalSessionId: null,
          targetBranch: "refs/remotes/origin",
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires an explicit model selection.",
    );

    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "reuse",
          sourceExternalSessionId: null,
          targetBranch: "refs/remotes/origin",
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires a source session.",
    );

    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "fork",
          sourceExternalSessionId: null,
          targetBranch: "refs/remotes/origin",
        },
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires a source session.",
    );
  });
});

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
