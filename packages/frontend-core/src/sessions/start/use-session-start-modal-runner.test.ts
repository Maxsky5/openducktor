import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  createRuntimeHookHarness as createHookHarness,
  createRuntimeDefinitionsContextValue,
} from "../../test-support/runtime-hook-harness";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createRuntimeCatalogFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import {
  buildSessionStartModalDecision,
  requireSourceSessionRuntimeKind,
  useSessionStartModalRunner,
} from "./use-session-start-modal-runner";
import { assertRuntimeSupportsSelectedStartMode } from "./session-start-validation";
import { observeStartupPreparation } from "../startup/startup-prepared-handoff";

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

const runtimeCatalogFixture = createRuntimeCatalogFixture({ models: CATALOG });

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

const FORKLESS_RUNTIME: RuntimeDescriptor = {
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
};

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

  test.each([
    {
      startMode: "fresh",
      speed: "fast",
      expected: { selectedModel: { ...SELECTED_MODEL, speed: "fast" } },
    },
    { startMode: "fork", speed: undefined, expected: { selectedModel: SELECTED_MODEL } },
    { startMode: "reuse", speed: "standard", expected: { speed: null } },
    { startMode: "reuse", speed: undefined, expected: {} },
  ] as const)("applies the $startMode start speed $speed", ({ startMode, speed, expected }) => {
    const input: Parameters<typeof buildSessionStartModalDecision>[0]["input"] = {
      startMode,
      sourceSessionOptionValue: startMode === "fresh" ? null : "session-1",
    };
    if (speed) input.speed = speed;
    const decision = buildSessionStartModalDecision({
      input,
      existingSessionOptions: [sourceOption("session-1")],
      requestContext: REQUEST_CONTEXT,
      selectedModel: { ...SELECTED_MODEL, speed: "fast" },
    });

    expect(decision).toMatchObject(expected);
    if (startMode === "reuse" && !speed) expect(decision).not.toHaveProperty("speed");
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
  test("settles cancellation without waiting for another React commit", async () => {
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
          loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
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
    await harness.waitFor((runner) => runner.sessionStartModal != null);

    let settled = false;
    void callerPromise.then(() => {
      settled = true;
    });
    await harness.run(async (runner) => {
      runner.sessionStartModal?.onOpenChange(false);
      await Promise.resolve();
      expect(settled).toBe(true);
    });

    expect(await callerPromise).toBeUndefined();
    await harness.unmount();
  });

  test("runs the confirmed request and then closes the modal", async () => {
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
          loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
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
    await harness.waitFor((runner) => runner.sessionStartModal == null);
    await harness.unmount();
  });
});

describe("useSessionStartModalRunner failures", () => {
  test.each(["dialog", "notification"] as const)(
    "modal close dismisses only feedback still shown in its dialog (%s)",
    async (presentation) => {
      const feedback = createFeedbackFake();
      const connection = createTestClientConnection({ feedback });
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
          connection,
          runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
            runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
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

      await harness.mount();
      try {
        await harness.run((runner) => {
          void runner.runSessionStartRequest(request, async () => {
            throw new Error("The host refused the start.");
          });
        });
        await harness.waitFor((runner) => runner.sessionStartModal?.selectedModelSelection != null);
        const requestId = harness.getLatest().sessionStartModal?.requestId;

        await harness.run(async (runner) => {
          await runner.sessionStartModal?.onConfirm({
            startMode: "fresh",
            sourceSessionOptionValue: null,
            runInBackground: false,
          });
        });

        const modal = harness.getLatest().sessionStartModal;
        expect(modal?.open).toBe(true);
        expect(modal?.isStarting).toBe(false);
        expect(modal?.requestId).toBe(requestId);
        expect(modal?.selectedModelSelection).toEqual(
          expect.objectContaining({
            providerId: SELECTED_MODEL.providerId,
            modelId: SELECTED_MODEL.modelId,
          }),
        );
        expect(modal?.phase.kind).toBe("progress");
        expect(feedback.shownOf("error")).toEqual([]);
        if (modal?.phase.kind !== "progress") throw new Error("Startup progress is missing.");
        const id = modal.phase.startupAttemptId;
        await harness.run((runner) => {
          if (presentation === "notification") connection.startupAttempts.continueInBackground(id);
          runner.sessionStartModal?.onOpenChange(false);
        });
        expect(harness.getLatest().sessionStartModal).toBeNull();
        if (presentation === "notification")
          expect(connection.startupAttempts.getAttempt(id)).toMatchObject({
            presentation: "notification",
            status: { phase: "failed", confirmation: "current" },
            error: "The host refused the start.",
          });
        else expect(connection.startupAttempts.getAttempt(id)).toBeNull();
      } finally {
        await harness.unmount();
      }
    },
  );
});

test.each([
  { outcome: "unconfirmed", leave: "dialog" },
  { outcome: "unconfirmed", leave: "background" },
  { outcome: "unconfirmed", leave: "unmount" },
  { outcome: "failed", leave: "background" },
  { outcome: "failed", leave: "unmount" },
] as const)("retains $outcome startup feedback through $leave", async ({ outcome, leave }) => {
  const connection = createTestClientConnection();
  const live = createStartupLiveSourceFake(connection.queryClient);
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
      workspaceId: "workspace",
    },
    {
      connection,
      runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
      }),
    },
  );
  const record = {
    ...sourceSession("started"),
    role: "build" as const,
    startedAt: "2026-10-27T00:00:00.000Z",
    selectedModel: { ...SELECTED_MODEL, runtimeKind: "opencode" as const },
  };
  const execute = mock(async ({ startupAttemptId }: { startupAttemptId: string }) => {
    await observeStartupPreparation(connection.queryClient, "/repo", startupAttemptId);
    const result = await connection.startupAttempts.operation(
      startupAttemptId,
      async (context) => ({
        startupProgress: {
          ...live.prepared({
            context,
            workspaceId: "workspace",
            repoPath: "/repo",
            scope: { kind: "task", taskId: "TASK-1", role: "build" },
            ownership: {
              state: "saved",
              target: {
                kind: "task",
                record,
                runtimeSession: { ...record, status: "idle" },
              },
            },
          }),
          phase: outcome === "failed" ? ("failed" as const) : ("completed" as const),
          steps: [{ id: "save", label: "Save session", state: "completed" as const, details: [] }],
        },
      }),
    );
    if (outcome === "unconfirmed") {
      live.remove(result.startupProgress.prepared!.ref);
      await connection.startupAttempts.complete(startupAttemptId);
    } else connection.startupAttempts.fail(startupAttemptId, "The workflow update failed.");
    return record;
  });
  let callerPromise!: Promise<typeof record | undefined>;
  let callerSettled = false;
  let callerResult: typeof record | undefined;
  let unmounted = false;
  await harness.mount();
  try {
    await harness.run((runner) => {
      callerPromise = runner.runSessionStartRequest(
        {
          source: "agent_studio",
          taskId: "TASK-1",
          role: "build",
          launchActionId: "build_implementation_start",
          postStartAction: "none",
          selectedModel: SELECTED_MODEL,
        },
        execute,
      );
      void callerPromise.then((result) => {
        callerSettled = true;
        callerResult = result;
      });
    });
    await harness.waitFor((runner) =>
      Boolean(runner.sessionStartModal && !runner.sessionStartModal.isSelectionCatalogLoading),
    );
    const requestId = harness.getLatest().sessionStartModal?.requestId;
    await harness.run(async (runner) => {
      await runner.sessionStartModal?.onConfirm({
        startMode: "fresh",
        sourceSessionOptionValue: null,
        runInBackground: false,
      });
    });
    const attempt = connection.startupAttempts.getSnapshot()[0];
    if (!attempt) throw new Error("Startup progress is missing.");
    const modal = harness.getLatest().sessionStartModal;
    expect(modal?.open).toBe(true);
    expect(modal?.requestId).toBe(requestId);
    expect(modal?.phase).toEqual({ kind: "progress", startupAttemptId: attempt.id });
    expect(modal?.isStarting).toBe(outcome === "unconfirmed");
    expect(attempt).toMatchObject({
      presentation: "dialog",
      ownership: { state: "saved", target: { record } },
      status: {
        phase: outcome === "unconfirmed" ? "running" : "failed",
        confirmation: outcome === "unconfirmed" ? "unconfirmed" : "current",
      },
    });
    expect(connection.startupAttempts.isReadyForHandoff(attempt.id)).toBe(false);
    if (outcome === "unconfirmed") {
      expect(callerSettled).toBe(true);
      expect(callerResult).toBeUndefined();
    }
    if (leave === "dialog") {
      await harness.run((runner) => runner.sessionStartModal?.onOpenChange(false));
      expect(harness.getLatest().sessionStartModal?.open).toBe(true);
      expect(connection.startupAttempts.getAttempt(attempt.id)?.presentation).toBe("dialog");
    } else {
      if (leave === "background") {
        await harness.run((runner) => runner.sessionStartModal?.onContinueInBackground());
        expect(harness.getLatest().sessionStartModal).toBeNull();
      } else {
        await harness.unmount();
        unmounted = true;
      }
      expect(connection.startupAttempts.getAttempt(attempt.id)).toMatchObject({
        presentation: "notification",
        ownership: attempt.ownership,
        operations: [
          expect.objectContaining({
            steps: [{ id: "save", label: "Save session", state: "completed", details: [] }],
          }),
        ],
        error: attempt.error,
      });
      expect(callerSettled).toBe(true);
      expect(callerResult).toBeUndefined();
    }
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    if (!unmounted) await harness.unmount();
    await connection.dispose();
  }
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
        runtimeKind: "opencode",
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
    expect(() =>
      requireSourceSessionRuntimeKind({
        ...sourceOption("session-2"),
        runtimeKind: null,
        sourceSession: {
          externalSessionId: "session-2",
          // @ts-expect-error This negative test verifies fail-fast handling of malformed persisted data.
          runtimeKind: null,
          workingDirectory: "/repo/worktree",
        },
        label: "Missing runtime session",
        description: "Reusable session without runtime",
      }),
    ).toThrow("Reusable session is missing a runtime kind.");
  });
});

test("prompt resolution ignores replaced requests and confirmation holds a synchronous lease", async () => {
  let resolveOld!: (text: string) => void;
  const oldPrompt = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  let finishStart!: () => void;
  const startPending = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  const execute = mock(async () => {
    await startPending;
    return "started";
  });
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
        loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
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
  await harness.mount();
  let oldResult!: Promise<string | undefined>;
  let currentResult!: Promise<string | undefined>;
  await harness.run((runner) => {
    oldResult = runner.runSessionStartRequest(
      { ...request, resolveKickoffPrompt: () => oldPrompt },
      execute,
    );
  });
  const oldConfirm = harness.getLatest().sessionStartModal?.onConfirm;
  await harness.run((runner) => {
    currentResult = runner.runSessionStartRequest(
      { ...request, resolveKickoffPrompt: async () => "current prompt" },
      execute,
    );
  });
  await harness.waitFor(
    (runner) =>
      runner.sessionStartModal?.kickoffPrompt === "current prompt" &&
      !runner.sessionStartModal.isSelectionCatalogLoading,
  );
  await harness.run(() => {
    resolveOld("old prompt");
  });
  expect(await oldResult).toBeUndefined();
  expect(harness.getLatest().sessionStartModal?.kickoffPrompt).toBe("current prompt");
  const input = {
    startMode: "fresh",
    sourceSessionOptionValue: null,
    runInBackground: false,
    kickoffPrompt: "edited",
  } as const;
  await harness.run((runner) => {
    oldConfirm?.(input);
    runner.sessionStartModal?.onConfirm(input);
    runner.sessionStartModal?.onConfirm(input);
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({ decision: expect.objectContaining({ kickoffPrompt: "edited" }) }),
  );
  await harness.run(() => {
    finishStart();
  });
  expect(await currentResult).toBe("started");
  await harness.unmount();
});

test("ignores out-of-order branch prompt results and blocks unresolved confirmation", async () => {
  const resolutions: {
    branch: string | undefined;
    resolve: (text: string) => void;
    reject: (cause: Error) => void;
  }[] = [];
  const execute = mock(async () => "started");
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
        loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
      }),
    },
  );

  await harness.mount();
  try {
    await harness.run((runner) => {
      void runner.runSessionStartRequest(
        {
          source: "agent_studio",
          taskId: "TASK-1",
          role: "build",
          launchActionId: "build_implementation_start",
          postStartAction: "kickoff",
          selectedModel: SELECTED_MODEL,
          resolveKickoffPrompt: (branch) =>
            new Promise<string>((resolve, reject) =>
              resolutions.push({ branch: branch?.branch, resolve, reject }),
            ),
        },
        execute,
      );
    });
    await harness.waitFor(() => resolutions.length === 1);
    await harness.run((runner) => {
      runner.sessionStartModal?.onSelectTargetBranch?.("refs/heads/one");
    });
    await harness.waitFor(() => resolutions.length === 2);
    await harness.run((runner) => {
      runner.sessionStartModal?.onSelectTargetBranch?.("refs/heads/two");
    });
    await harness.waitFor(() => resolutions.length === 3);
    expect(resolutions.map((entry) => entry.branch)).toEqual(["main", "one", "two"]);
    await harness.run((runner) => {
      runner.sessionStartModal?.onConfirm({
        startMode: "fresh",
        sourceSessionOptionValue: null,
        kickoffPrompt: "unresolved",
        runInBackground: false,
      });
    });
    expect(execute).not.toHaveBeenCalled();
    await harness.run(() => {
      resolutions[2]!.resolve("prompt for two");
    });
    await harness.waitFor((runner) => runner.sessionStartModal?.kickoffPrompt === "prompt for two");
    await harness.run(() => {
      resolutions[1]!.resolve("stale one");
      resolutions[0]!.reject(new Error("stale error"));
    });
    expect(harness.getLatest().sessionStartModal?.kickoffPrompt).toBe("prompt for two");
    expect(harness.getLatest().sessionStartModal?.kickoffPromptError).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    await harness.run((runner) => {
      runner.sessionStartModal?.onSelectTargetBranch?.("refs/heads/one");
    });
    await harness.run((runner) => {
      runner.sessionStartModal?.onSelectTargetBranch?.("refs/heads/two");
    });
    expect(resolutions).toHaveLength(5);
    expect(harness.getLatest().sessionStartModal?.kickoffPrompt).toBeUndefined();
    expect(harness.getLatest().sessionStartModal?.isKickoffPromptLoading).toBe(true);
    await harness.run((runner) => {
      runner.sessionStartModal?.onConfirm({
        startMode: "fresh",
        sourceSessionOptionValue: null,
        kickoffPrompt: "prompt for two",
        runInBackground: false,
      });
    });
    expect(execute).not.toHaveBeenCalled();
    await harness.run(() => resolutions[4]!.resolve("refreshed prompt for two"));
    expect(harness.getLatest().sessionStartModal?.kickoffPrompt).toBe("refreshed prompt for two");
  } finally {
    await harness.run((runner) => {
      runner.sessionStartModal?.onOpenChange(false);
    });
    await harness.unmount();
  }
});

for (const changedScope of ["task", "workspace", "role"] as const) {
  test(`confirmation in another ${changedScope} retains its own pending state`, async () => {
    let finishA!: () => void;
    let finishB!: () => void;
    const pendingA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    const pendingB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    const executeA = mock(async () => {
      await pendingA;
      return "A";
    });
    const executeB = mock(async () => {
      await pendingB;
      return "B";
    });
    const props = {
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
      scopeKey: "/repo:TASK-1:build",
    };
    const harness = createHookHarness(useSessionStartModalRunner, props, {
      runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
      }),
    });
    const request = {
      source: "agent_studio",
      taskId: "TASK-1",
      role: "build",
      launchActionId: "build_implementation_start",
      postStartAction: "none",
      selectedModel: SELECTED_MODEL,
    } as const;
    const input = {
      startMode: "fresh",
      sourceSessionOptionValue: null,
      runInBackground: false,
    } as const;
    await harness.mount();
    try {
      let resultA!: Promise<string | undefined>;
      let resultB!: Promise<string | undefined>;
      await harness.run((runner) => {
        resultA = runner.runSessionStartRequest(request, executeA);
      });
      await harness.waitFor((runner) =>
        Boolean(runner.sessionStartModal && !runner.sessionStartModal.isSelectionCatalogLoading),
      );
      await harness.run((runner) => {
        void runner.sessionStartModal?.onConfirm(input);
      });
      expect(executeA).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isSessionStarting).toBe(true);
      await harness.update({
        ...props,
        workspaceRepoPath: changedScope === "workspace" ? "/other" : "/repo",
        scopeKey:
          changedScope === "workspace"
            ? "/other:TASK-1:build"
            : changedScope === "task"
              ? "/repo:TASK-2:build"
              : "/repo:TASK-1:qa",
      });
      expect(await resultA).toBeUndefined();
      expect(harness.getLatest().isSessionStarting).toBe(false);
      await harness.run((runner) => {
        resultB = runner.runSessionStartRequest(
          { ...request, taskId: changedScope === "task" ? "TASK-2" : "TASK-1" },
          executeB,
        );
      });
      await harness.waitFor((runner) =>
        Boolean(runner.sessionStartModal && !runner.sessionStartModal.isSelectionCatalogLoading),
      );
      expect(harness.getLatest().sessionStartModal?.isStarting).toBe(false);
      await harness.run((runner) => {
        void runner.sessionStartModal?.onConfirm(input);
      });
      expect(executeB).toHaveBeenCalledTimes(1);
      await harness.run(() => {
        finishA();
      });
      expect(harness.getLatest().sessionStartModal?.isStarting).toBe(true);
      expect(harness.getLatest().isSessionStarting).toBe(true);
      await harness.run((runner) => {
        void runner.sessionStartModal?.onConfirm(input);
        expect(() => runner.runSessionStartRequest(request, executeB)).toThrow(
          "A session start is already in progress.",
        );
        runner.sessionStartModal?.onOpenChange(false);
      });
      expect(harness.getLatest().sessionStartModal?.open).toBe(true);
      expect(executeB).toHaveBeenCalledTimes(1);
      await harness.run(() => {
        finishB();
      });
      expect(await resultB).toBe("B");
      expect(harness.getLatest().isSessionStarting).toBe(false);
      expect(executeA).toHaveBeenCalledTimes(1);
      expect(executeB).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().sessionStartModal?.open).not.toBe(true);
    } finally {
      await harness.run(() => {
        finishA();
        finishB();
      });
      await harness.unmount();
    }
  });
}

test.each(["submit", "continue"] as const)(
  "a background %s frees the modal for another task while both launches keep their origin",
  async (transfer) => {
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({ feedback });
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const onBackgroundTransfer = mock((attemptId: string) => {
      expect(connection.startupAttempts.getAttempt(attemptId)?.presentation).toBe("notification");
    });
    const execute = mock(
      async ({
        request,
      }: Parameters<
        Parameters<ReturnType<typeof useSessionStartModalRunner>["runSessionStartRequest"]>[1]
      >[0]) => {
        await (request.taskId === "TASK-1" ? first.promise : second.promise);
        return {
          externalSessionId: `native-${request.taskId}`,
          runtimeKind: "codex" as const,
          workingDirectory: "/repo/worktree",
          postStartActionError: null,
        };
      },
    );
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
        workspaceId: "workspace",
        scopeKey: "workspace",
        onBackgroundTransfer,
      },
      {
        connection,
        runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
          availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
          loadRepoRuntimeCatalog: async () => runtimeCatalogFixture,
        }),
      },
    );
    const request = {
      source: "task_action",
      taskId: "TASK-1",
      role: "build",
      launchActionId: "build_implementation_start",
      postStartAction: "none",
      selectedModel: SELECTED_MODEL,
    } as const;
    const input = {
      startMode: "fresh",
      sourceSessionOptionValue: null,
      runInBackground: true,
    } as const;
    let resultA!: Promise<Awaited<ReturnType<typeof execute>> | undefined>;
    let resultB!: Promise<Awaited<ReturnType<typeof execute>> | undefined>;
    let firstSettled = false;
    await harness.mount();
    try {
      await harness.run((runner) => {
        resultA = runner.runSessionStartRequest(request, execute);
        void resultA.then(() => {
          firstSettled = true;
        });
      });
      await harness.waitFor((runner) =>
        Boolean(runner.sessionStartModal && !runner.sessionStartModal.isSelectionCatalogLoading),
      );
      await harness.run((runner) => {
        const confirm = runner.sessionStartModal?.onConfirm;
        const choices = {
          ...input,
          runInBackground: transfer === "submit",
        };
        void confirm?.(choices);
        void confirm?.(choices);
      });
      expect(execute).toHaveBeenCalledTimes(1);
      if (transfer === "continue") expect(onBackgroundTransfer).not.toHaveBeenCalled();
      if (transfer === "continue")
        await harness.run((runner) => {
          runner.sessionStartModal?.onContinueInBackground();
        });
      expect(onBackgroundTransfer.mock.calls).toEqual([
        [execute.mock.calls[0]![0].startupAttemptId],
      ]);
      expect(firstSettled).toBe(false);
      expect(harness.getLatest().sessionStartModal).toBeNull();
      expect(harness.getLatest().isSessionStarting).toBe(false);
      await harness.run((runner) => {
        resultB = runner.runSessionStartRequest({ ...request, taskId: "TASK-2" }, execute);
      });
      await harness.waitFor((runner) =>
        Boolean(runner.sessionStartModal && !runner.sessionStartModal.isSelectionCatalogLoading),
      );
      await harness.run((runner) => {
        void runner.sessionStartModal?.onConfirm({ ...input, runInBackground: false });
      });
      expect(execute).toHaveBeenCalledTimes(2);
      const secondRequestId = harness.getLatest().sessionStartModal?.requestId;
      expect(harness.getLatest().isSessionStarting).toBe(true);
      expect(
        connection.startupAttempts.getSnapshot().map((attempt) => attempt.origin.scope),
      ).toEqual([
        { kind: "task", taskId: "TASK-1", role: "build" },
        { kind: "task", taskId: "TASK-2", role: "build" },
      ]);
      await harness.run(() => {
        first.resolve();
      });
      expect((await resultA)?.externalSessionId).toBe("native-TASK-1");
      expect(harness.getLatest().sessionStartModal?.requestId).toBe(secondRequestId);
      expect(harness.getLatest().isSessionStarting).toBe(true);
      await harness.run((runner) => {
        expect(() => runner.runSessionStartRequest(request, execute)).toThrow(
          "A session start is already in progress.",
        );
        runner.sessionStartModal?.onContinueInBackground();
      });
      expect(harness.getLatest().isSessionStarting).toBe(false);
      await harness.run(() => {
        second.resolve();
      });
      expect((await resultB)?.externalSessionId).toBe("native-TASK-2");
      expect(execute).toHaveBeenCalledTimes(2);
      expect(onBackgroundTransfer.mock.calls).toEqual([
        [execute.mock.calls[0]![0].startupAttemptId],
        [execute.mock.calls[1]![0].startupAttemptId],
      ]);
      expect(feedback.shownOf("error")).toEqual([]);
    } finally {
      first.resolve();
      second.resolve();
      await harness.unmount();
      await connection.dispose();
    }
  },
);
