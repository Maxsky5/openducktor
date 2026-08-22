import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  createHookHarness,
  createRuntimeDefinitionsContextValue,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import {
  assertRuntimeSupportsSelectedStartMode,
  buildSessionStartModalDecision,
  requireSourceSessionRuntimeKind,
  useSessionStartModalRunner,
} from "./use-session-start-modal-runner";

enableReactActEnvironment();

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

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["high"],
    },
  ],
  defaultModelsByProvider: { anthropic: "claude-sonnet" },
  profiles: [{ name: "build-agent", mode: "primary", hidden: false }],
};

const sourceSession = (externalSessionId: string, runtimeKind: RuntimeKind = "opencode") => ({
  externalSessionId,
  runtimeKind,
  workingDirectory: "/repo/worktree",
});

const sourceOption = (externalSessionId: string, runtimeKind: RuntimeKind = "opencode") => ({
  value: externalSessionId,
  sourceSession: sourceSession(externalSessionId, runtimeKind),
  label: "Reusable session",
  description: "Reusable session",
  runtimeKind,
  selectedModel: null,
});

// SAFETY: This test controls the fixture and supplies `RuntimeDescriptor` used by this case.
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
          sourceSessionOptionValue: null,
        },
        existingSessionOptions: [],
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
          sourceSessionOptionValue: "session-1",
          targetBranch: "refs/remotes/origin/feature/session-start",
        },
        existingSessionOptions: [sourceOption("session-1")],
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toEqual({
      startMode: "reuse",
      sourceSession: sourceSession("session-1"),
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
          sourceSessionOptionValue: "session-2",
          targetBranch: "refs/heads/local-review",
        },
        existingSessionOptions: [sourceOption("session-2")],
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toEqual({
      startMode: "fork",
      selectedModel: SELECTED_MODEL,
      sourceSession: sourceSession("session-2"),
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
          sourceSessionOptionValue: null,
        },
        existingSessionOptions: [],
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
          sourceSessionOptionValue: null,
        },
        existingSessionOptions: [],
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
          sourceSessionOptionValue: null,
          targetBranch: "refs/remotes/origin",
        },
        existingSessionOptions: [],
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
          sourceSessionOptionValue: null,
          targetBranch: "refs/remotes/origin",
        },
        existingSessionOptions: [],
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
          sourceSessionOptionValue: null,
          targetBranch: "refs/remotes/origin",
        },
        existingSessionOptions: [],
        requestContext: REQUEST_CONTEXT,
        selectedModel: null,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires an explicit model selection.",
    );

    expect(() =>
      buildSessionStartModalDecision({
        input: {
          startMode: "fork",
          sourceSessionOptionValue: null,
          targetBranch: "refs/remotes/origin",
        },
        existingSessionOptions: [],
        requestContext: REQUEST_CONTEXT,
        selectedModel: SELECTED_MODEL,
      }),
    ).toThrow(
      "Starting a build build_pull_request_generation session for TASK-1 requires a source session.",
    );
  });
});

describe("useSessionStartModalRunner", () => {
  test("clears start state and closes the modal before the caller resumes", async () => {
    const harness = createHookHarness(
      useSessionStartModalRunner,
      {
        favoriteState: {
          favorites: [],
          isLoading: false,
          readError: null,
          isMutationPending: false,
          mutationError: null,
          canMutate: false,
          toggleFavorite: () => {},
          retryRead: () => {},
          retryMutation: () => {},
        },
        repoSettings: null,
        workspaceRepoPath: "/repo",
      },
      {
        runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
          availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
          loadRepoRuntimeCatalog: async () => CATALOG,
        }),
      },
    );
    const request = {
      source: "agent_studio",
      taskId: "TASK-1",
      role: "build",
      launchActionId: "build_implementation_start",
      postStartAction: "kickoff",
      selectedModel: SELECTED_MODEL,
    } as const;
    let callerPromise!: Promise<string | undefined>;

    await harness.mount();
    await harness.run((runner) => {
      callerPromise = runner.runSessionStartRequest(request, async () => "started");
    });
    await harness.waitFor((runner) => runner.sessionStartModal?.selectedModelSelection != null);

    const stateWhenCallerResumed = callerPromise.then(() => harness.getLatest());
    await harness.run(async (runner) => {
      const modal = runner.sessionStartModal;
      if (!modal) {
        throw new Error("Expected the session start modal to be open.");
      }
      await modal.onConfirm({
        startMode: "fresh",
        sourceSessionOptionValue: null,
        runInBackground: false,
      });
    });

    expect(await callerPromise).toBe("started");
    expect((await stateWhenCallerResumed).sessionStartModal).toBeNull();
    await harness.unmount();
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
    // SAFETY: This test controls the fixture and supplies `RuntimeKind` used by this case.
    expect(() =>
      assertRuntimeSupportsSelectedStartMode({
        launchActionId: "build_implementation_start",
        role: "build",
        runtimeDescriptor: null,
        runtimeKind: "missing-runtime" as RuntimeKind,
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
        ...sourceOption("session-1"),
        label: "Reusable session",
        description: "Reusable session with runtime",
      }),
    ).toBe("opencode");
  });

  test("fails fast when a reusable session has no runtime kind", () => {
    const missingRuntimeKind: RuntimeKind | null = null;
    const invalidRuntimeKind = (value: RuntimeKind | null): RuntimeKind => {
      // SAFETY: this test passes malformed persisted data through the static contract.
      return value as RuntimeKind;
    };
    expect(() =>
      requireSourceSessionRuntimeKind({
        ...sourceOption("session-2", invalidRuntimeKind(missingRuntimeKind)),
        sourceSession: {
          externalSessionId: "session-2",
          runtimeKind: invalidRuntimeKind(missingRuntimeKind),
          workingDirectory: "/repo/worktree",
        },
        label: "Missing runtime session",
        description: "Reusable session without runtime",
      }),
    ).toThrow("Reusable session is missing a runtime kind.");
  });
});
