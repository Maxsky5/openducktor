import { describe, expect, type Mock, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { GitConflict } from "@/features/agent-studio-git";
import { GitConflictRequestCancelled } from "@/features/git-conflict-resolution/conflict-assistance";
import {
  type SessionStartWorkflowResult,
  startSessionWorkflow,
} from "@/features/session-start/session-start-workflow";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createAgentMessageSendReceipt } from "@/test-utils/agent-message-send-fixture";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createAgentSessionSummaryFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRebaseConflictResolution } from "./use-agent-studio-rebase-conflict-resolution";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRebaseConflictResolution>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRebaseConflictResolution, initialProps);

const sessionWorkflowResult = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
  postStartActionError: null,
  postStartMessageReceipt: createAgentMessageSendReceipt({
    externalSessionId,
    runtimeKind: "opencode",
    workingDirectory: `/repo/worktrees/${externalSessionId}`,
  }),
});

const buildSession = (overrides: Parameters<typeof createAgentSessionSummaryFixture>[0] = {}) =>
  createAgentSessionSummaryFixture({
    runtimeKind: "opencode",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

    status: "running",
    ...overrides,
  });

const createSelectedSession = (
  overrides: Partial<HookArgs["selection"]["view"]["selectedSession"]> = {},
): HookArgs["selection"]["view"]["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
    catalogError: null,
    todosError: null,
    runtimePolicyError: null,
    contextError: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
  ...overrides,
});

type GitConflictOverrides = Partial<GitConflict>;

const createConflict = (overrides: GitConflictOverrides = {}) => ({
  operation: "rebase" as const,
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "CONFLICT (content): Merge conflict in src/conflict.ts",
  workingDir: "/repo/worktrees/task-1",
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => {
  const builderSession = buildSession({
    externalSessionId: "build-1",
    workingDirectory: "/repo/worktrees/task-1",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    },
  });
  const plannerSession = createAgentSessionSummaryFixture({
    runtimeKind: "opencode",
    externalSessionId: "planner-1",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },

    status: "running",
  });

  return {
    workspaceId: "workspace-repo",
    assertSessionCanSend: () => {},
    selection: {
      view: {
        taskId: "task-1",
        role: "planner",
        selectedTask: createTaskCardFixture({
          id: "task-1",
          title: "Resolve rebase conflict",
          description: "Fix the branch divergence.",
        }),
        selectedSession: createSelectedSession({
          identity: toAgentSessionIdentity(plannerSession),
        }),
        sessionsForTask: [builderSession],
      },
    },
    scheduleQueryUpdate: mock(() => {}),
    startSessionRequest: mock(async () => sessionWorkflowResult("build-new-1")),
    loadPromptOverrides: mock(async () => ({})),
    ...overrides,
  };
};

describe("useAgentStudioRebaseConflictResolution", () => {
  test("retries a failed conflict message after opening its Builder", async () => {
    const retry = createRetryHarness();
    try {
      await retry.harness.mount();
      const workflow = await retry.start();
      const builder = toAgentSessionIdentity(workflow);
      expect(retry.args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: builder.externalSessionId,
        runtimeKind: builder.runtimeKind,
        workingDirectory: "/repo/worktrees/task-1",
        agent: "build",
      });

      await retry.select(builder);
      await workflow.retryPostStartMessage?.();

      expect(retry.send).toHaveBeenCalledTimes(2);
      expect(retry.send.mock.calls[1]).toEqual(retry.send.mock.calls[0]);
      expect(retry.send.mock.calls[1]?.[0]).toEqual(builder);
      expect(retry.send.mock.calls[1]?.[1]).toEqual([
        { kind: "text", text: expect.stringContaining("src/conflict.ts") },
      ]);
    } finally {
      await retry.close();
    }
  });

  const changes: {
    name: string;
    apply: (args: HookArgs, builder: AgentSessionIdentity) => HookArgs;
  }[] = [
    { name: "workspace", apply: (args) => ({ ...args, workspaceId: "other-workspace" }) },
    {
      name: "task",
      apply: (args) => ({
        ...args,
        selection: { view: { ...args.selection.view, taskId: "other-task" } },
      }),
    },
    ...(
      [
        { name: "chat", identity: { externalSessionId: "other-builder" } },
        { name: "runtime", identity: { runtimeKind: "claude" as const } },
        { name: "directory", identity: { workingDirectory: "/repo/worktrees/other" } },
        { name: "missing chat", identity: null },
      ] as const
    ).map(({ name, identity }) => ({
      name,
      apply: (args: HookArgs, builder: AgentSessionIdentity): HookArgs => ({
        ...args,
        selection: {
          view: {
            ...args.selection.view,
            selectedSession: createSelectedSession({
              identity: identity ? { ...builder, ...identity } : null,
            }),
          },
        },
      }),
    })),
  ];
  test.each(
    changes.flatMap((change) =>
      [false, true].map((opened) => ({
        ...change,
        opened,
        when: opened ? "after" : "before",
      })),
    ),
  )("stops retry after a $name change $when opening the Builder", async ({ apply, opened }) => {
    const retry = createRetryHarness();
    try {
      await retry.harness.mount();
      const workflow = await retry.start();
      const builder = toAgentSessionIdentity(workflow);
      if (opened) await retry.select(builder);

      await retry.harness.update(
        apply(
          {
            ...retry.args,
            selection: {
              view: {
                ...retry.args.selection.view,
                role: "build",
                selectedSession: createSelectedSession({ identity: builder }),
              },
            },
          },
          builder,
        ),
      );
      await retry.select(builder);
      await expect(workflow.retryPostStartMessage?.()).rejects.toBeInstanceOf(
        GitConflictRequestCancelled,
      );
      expect(retry.send).toHaveBeenCalledTimes(1);
    } finally {
      await retry.close();
    }
  });

  test("a later Builder request does not restore an older retry", async () => {
    const retry = createRetryHarness();
    try {
      await retry.harness.mount();
      const first = await retry.start();
      await retry.select(toAgentSessionIdentity(first));
      const second = await retry.start();
      await retry.select(toAgentSessionIdentity(second));

      await expect(first.retryPostStartMessage?.()).rejects.toBeInstanceOf(
        GitConflictRequestCancelled,
      );
      expect(retry.send).toHaveBeenCalledTimes(2);
      await second.retryPostStartMessage?.();
      expect(retry.send).toHaveBeenCalledTimes(3);
      expect(retry.send.mock.calls[2]?.[0]).toEqual(toAgentSessionIdentity(second));
    } finally {
      await retry.close();
    }
  });

  test("checks the live send policy on retry after opening the Builder", async () => {
    const denied = new Error("Answer the Builder question before sending.");
    let blocked = false;
    const retry = createRetryHarness({
      assertSessionCanSend: () => {
        if (blocked) throw denied;
      },
    });
    try {
      await retry.harness.mount();
      const workflow = await retry.start();
      await retry.select(toAgentSessionIdentity(workflow));
      blocked = true;

      await expect(workflow.retryPostStartMessage?.()).rejects.toThrow(denied);
      expect(retry.send).toHaveBeenCalledTimes(1);
    } finally {
      await retry.close();
    }
  });

  test("checks the conflict owner on retry after opening the Builder", async () => {
    const retry = createRetryHarness();
    let cancelled = false;
    try {
      await retry.harness.mount();
      const workflow = await retry.start(() => {
        if (cancelled) throw new GitConflictRequestCancelled();
      });
      await retry.select(toAgentSessionIdentity(workflow));
      cancelled = true;

      await expect(workflow.retryPostStartMessage?.()).rejects.toBeInstanceOf(
        GitConflictRequestCancelled,
      );
      expect(retry.send).toHaveBeenCalledTimes(1);
    } finally {
      await retry.close();
    }
  });

  test("routes conflict resolution through the shared session-start request", async () => {
    const args = createBaseArgs({
      startSessionRequest: mock(async () => sessionWorkflowResult("build-1")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toEqual(
        expect.objectContaining({ acceptedMessage: expect.objectContaining({ state: "read" }) }),
      );
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          postStartAction: "send_message",
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-1",
        agent: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("filters reusable Builder sessions to the conflicted worktree", async () => {
    const matchingBuilderSession = buildSession({
      externalSessionId: "build-1",
      workingDirectory: "/repo/worktrees/task-1",
    });
    const otherBuilderSession = buildSession({
      externalSessionId: "build-other",
      workingDirectory: "/repo/worktrees/other",
    });
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [matchingBuilderSession, otherBuilderSession],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-1")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toEqual(
        expect.objectContaining({ acceptedMessage: expect.objectContaining({ state: "read" }) }),
      );
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          existingSessionOptions: [
            expect.objectContaining({
              value: agentSessionIdentityKey(matchingBuilderSession),
              sourceSession: {
                externalSessionId: "build-1",
                runtimeKind: "opencode",
                workingDirectory: "/repo/worktrees/task-1",
              },
            }),
          ],
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not require an existing selected model to request a new conflict session", async () => {
    const baseSelection = createBaseArgs().selection;
    const builderSession = buildSession({
      externalSessionId: "build-1",
      workingDirectory: "/repo/worktrees/task-1",
      selectedModel: null,
    });
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [builderSession],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-new-9")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toEqual(
        expect.objectContaining({ acceptedMessage: expect.objectContaining({ state: "read" }) }),
      );
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
          targetWorkingDirectory: "/repo/worktrees/task-1",
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-new-9",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-new-9",
        agent: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("passes the conflicted worktree when requesting a fresh conflict session", async () => {
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          sessionsForTask: [],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-new-9")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toEqual(
        expect.objectContaining({ acceptedMessage: expect.objectContaining({ state: "read" }) }),
      );
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "fresh",
          targetWorkingDirectory: "/repo/worktrees/task-1",
        }),
      );
      expect(args.scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "build-new-9",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-new-9",
        agent: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("fails when the conflicted working directory is missing", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      await expect(
        harness.getLatest().handleResolveRebaseConflict(createConflict({ workingDir: null })),
      ).rejects.toThrow(
        'Cannot resolve a git conflict for task "task-1" because the conflicted working directory is missing.',
      );

      expect(args.startSessionRequest).not.toHaveBeenCalled();
      expect(args.scheduleQueryUpdate).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("returns false when the shared session-start flow is cancelled", async () => {
    const args = createBaseArgs({
      startSessionRequest: mock(async () => undefined),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toBe(false);
      expect(args.scheduleQueryUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("uses the live selected Builder session without a shell-side summary wrapper", async () => {
    const liveBuilderSession = createAgentSessionFixture({
      externalSessionId: "build-live-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      status: "running",
      workingDirectory: "/repo/worktrees/task-1",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    const baseSelection = createBaseArgs().selection;
    const args = createBaseArgs({
      selection: {
        ...baseSelection,
        view: {
          ...baseSelection.view,
          selectedSession: createSelectedSession({
            identity: toAgentSessionIdentity(liveBuilderSession),
            loadedSession: liveBuilderSession,
          }),
          sessionsForTask: [],
        },
      },
      startSessionRequest: mock(async () => sessionWorkflowResult("build-live-1")),
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveRebaseConflict(createConflict());

      expect(resolved).toEqual(
        expect.objectContaining({ acceptedMessage: expect.objectContaining({ state: "read" }) }),
      );
      expect(args.startSessionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "build-live-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the resolve callback stable when the selection object is rebuilt", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const initialResolve = harness.getLatest().handleResolveRebaseConflict;

      await harness.update({
        ...args,
        selection: {
          ...args.selection,
        },
      });

      expect(harness.getLatest().handleResolveRebaseConflict).toBe(initialResolve);
    } finally {
      await harness.unmount();
    }
  });
});

type SendAgentMessage =
  import("@/types/state-slices").AgentOperationsContextValue["sendAgentMessage"];

type RetryHarness = {
  args: HookArgs;
  harness: ReturnType<typeof createHookHarness>;
  send: Mock<SendAgentMessage>;
  start: (ownerGuard?: () => void) => Promise<SessionStartWorkflowResult>;
  select: (identity: AgentSessionIdentity) => Promise<void>;
  close: () => Promise<void>;
};

function createRetryHarness(
  overrides: Partial<Pick<HookArgs, "assertSessionCanSend">> = {},
): RetryHarness {
  const queryClient = new QueryClient();
  const failure = new Error("Transport rejected the first message");
  const failed = new Set<string>();
  const send = mock<SendAgentMessage>(async (session) => {
    const key = agentSessionIdentityKey(session);
    if (!failed.has(key)) {
      failed.add(key);
      throw failure;
    }
    return createAgentMessageSendReceipt(session);
  });
  const workflows: SessionStartWorkflowResult[] = [];
  const base = createBaseArgs();
  const args = createBaseArgs({
    ...overrides,
    selection: { view: { ...base.selection.view, sessionsForTask: [] } },
    startSessionRequest: async (request) => {
      const builder = createAgentSessionFixture({
        externalSessionId: `build-new-${workflows.length + 1}`,
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/task-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "idle",
      });
      const identity = toAgentSessionIdentity(builder);
      let retained: import("@openducktor/contracts").WorkflowLaunchSnapshot;
      const parts = [{ kind: "text" as const, text: request.message }];
      const workflow = await startSessionWorkflow({
        workspaceId: args.workspaceId!,
        repoPath: "/repo",
        launchAttemptId: `attempt-${workflows.length + 1}`,
        request,
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
        },
        readSessionSnapshot: () => builder,
        client: {
          agentSessionWorkflowLaunchRead: async () => [retained],
          agentSessionWorkflowLaunch: async (launch) => {
            retained = {
              launchAttemptId: launch.launchAttemptId,
              workspaceId: launch.workspaceId,
              repoPath: launch.repoPath,
              taskId: launch.taskId,
              role: "build",
              phase: "failed",
              acceptance: "rejected",
              ownershipSaved: true,
              completedPreStartActions: [],
              recoveryAllowed: true,
              session: { ...identity, startedAt: builder.startedAt, status: "idle" },
            };
            try {
              await send(identity, parts);
            } catch (cause) {
              retained.failure = {
                message: cause instanceof Error ? cause.message : String(cause),
                stage: "send",
                cleanupErrors: [],
              };
            }
            return retained;
          },
          agentSessionWorkflowLaunchRecover: async () => {
            const receipt = await send(identity, parts);
            return {
              ...retained,
              phase: "completed",
              acceptance: "accepted",
              failure: undefined,
              acceptedMessage: receipt!.acceptedMessage,
            };
          },
        },
      });
      workflows.push(workflow);
      return workflow;
    },
  });
  const harness = createHookHarness(args);
  return {
    args,
    harness,
    send,
    start: async (ownerGuard?: () => void): Promise<SessionStartWorkflowResult> => {
      await expect(
        harness.getLatest().handleResolveRebaseConflict(createConflict(), ownerGuard),
      ).rejects.toThrow(failure);
      const workflow = workflows.at(-1);
      if (!workflow?.retryPostStartMessage) throw new Error("Message retry is missing");
      return workflow;
    },
    select: async (identity: AgentSessionIdentity): Promise<void> => {
      await harness.update({
        ...args,
        selection: {
          view: {
            ...args.selection.view,
            role: "build",
            selectedSession: createSelectedSession({ identity }),
          },
        },
      });
    },
    close: async (): Promise<void> => {
      await harness.unmount();
      queryClient.clear();
    },
  };
}
