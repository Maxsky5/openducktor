import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import type { RunSessionStartWorkflow } from "../../sessions/start/session-start-orchestration";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import {
  createRuntimeDefinitionsContextValue,
  createRuntimeHookHarness,
} from "../../test-support/runtime-hook-harness";
import {
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import { observeStartupPreparation } from "../../sessions/startup/startup-prepared-handoff";
import { type OpenTaskView, useTaskSessionStartFlow } from "./use-task-session-start-flow";

type Args = Parameters<typeof useTaskSessionStartFlow>[0];

const builderSession = (externalSessionId: string, startedAt: string): AgentSessionSummary =>
  createAgentSessionSummaryFixture({
    externalSessionId,
    startedAt,
    sessionAssociation: { kind: "workflow", taskId: "TASK-1", role: "build" },
    workingDirectory: `/repo/worktrees/${externalSessionId}`,
  });

const createArgs = (overrides: Partial<Args> = {}): Args => ({
  activeWorkspaceId: "workspace-1",
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: true,
    toggleFavorite: () => {},
    retryRead: () => {},
    retryMutation: () => {},
  },
  repoSettings: null,
  tasks: [createTaskCardFixture({}, { id: "TASK-1", status: "in_progress" }) satisfies TaskCard],
  sessions: [],
  openTaskView: mock<OpenTaskView>(() => {}),
  workspaceRepoPath: "/repo",
  runSessionStartWorkflow: mock<RunSessionStartWorkflow>(async () => {
    throw new Error("The test starts no session.");
  }),
  ...overrides,
});

const createHarness = (args: Args, feedback = createFeedbackFake()) => ({
  feedback,
  harness: createRuntimeHookHarness(useTaskSessionStartFlow, args, {
    connection: createTestClientConnection({ feedback }),
  }),
});

describe("useTaskSessionStartFlow", () => {
  test("opens the session that the user picked and names its repository", async () => {
    const openTaskView = mock<OpenTaskView>(() => {});
    const session = builderSession("builder-1", "2026-02-22T10:00:00.000Z");
    const { harness } = createHarness(createArgs({ openTaskView }));
    await harness.mount();
    try {
      await harness.run((flow) => flow.onOpenSession("TASK-1", "build", { session }));
      expect(openTaskView).toHaveBeenCalledWith(
        {
          kind: "task_session",
          workspaceId: "workspace-1",
          taskId: "TASK-1",
          role: "build",
          identity: {
            externalSessionId: "builder-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/builder-1",
          },
        },
        { repoPath: "/repo" },
      );
    } finally {
      await harness.unmount();
    }
  });

  test("reports a picked session without a selected workspace and opens nothing", async () => {
    const openTaskView = mock<OpenTaskView>(() => {});
    const session = builderSession("builder-1", "2026-02-22T10:00:00.000Z");
    const { feedback, harness } = createHarness(
      createArgs({ openTaskView, activeWorkspaceId: null, workspaceRepoPath: null }),
    );
    await harness.mount();
    try {
      await harness.run((flow) => flow.onOpenSession("TASK-1", "build", { session }));
      expect(openTaskView).not.toHaveBeenCalled();
      expect(feedback.shownOf("error")).toEqual([
        {
          kind: "error",
          message: "Failed to open the session.",
          options: { description: "Select the task's workspace, then open the session again." },
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("opens the latest session of a role, or the role view when the task has none", async () => {
    const openTaskView = mock<OpenTaskView>(() => {});
    const sessions = [
      builderSession("builder-old", "2026-02-22T09:00:00.000Z"),
      builderSession("builder-new", "2026-02-22T11:00:00.000Z"),
    ];
    const { harness } = createHarness(createArgs({ openTaskView, sessions }));
    await harness.mount();
    try {
      await harness.run((flow) => flow.onBuild("TASK-1"));
      await harness.run((flow) => flow.onQaOpen("TASK-1"));
      expect(openTaskView.mock.calls).toEqual([
        [
          {
            kind: "task_session",
            workspaceId: "workspace-1",
            taskId: "TASK-1",
            role: "build",
            identity: {
              externalSessionId: "builder-new",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktrees/builder-new",
            },
          },
        ],
        [{ kind: "task", workspaceId: "workspace-1", taskId: "TASK-1", role: "qa" }],
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("shows the start choices of a QA review before any launch", async () => {
    const args = createArgs();
    const { harness } = createHarness(args);
    await harness.mount();
    try {
      await harness.run((flow) => flow.onQaStart("TASK-1"));
      await harness.waitFor((flow) => flow.sessionStartModal !== null);
      expect(harness.getLatest().sessionStartModal).toMatchObject({
        open: true,
        title: "Start QA Session",
        allowRunInBackground: true,
      });
      expect(args.runSessionStartWorkflow).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test.each(["submit", "continue"] as const)(
    "a background %s keeps Request Changes feedback pending and never opens the session",
    async (transfer) => {
      const pending = Promise.withResolvers<void>();
      const session = builderSession("builder-1", "2026-02-22T10:00:00.000Z");
      const runSessionStartWorkflow = mock<RunSessionStartWorkflow>(async (input) => {
        const id = input.startupAttemptId;
        if (!id) throw new Error("The launch must name its startup attempt.");
        await observeStartupPreparation(connection.queryClient, "/repo", id);
        await pending.promise;
        await connection.startupAttempts.operation(id, async (context) => ({
          startupProgress: live.prepared({
            context,
            workspaceId: "workspace-1",
            repoPath: "/repo",
            scope: { kind: "task", taskId: "TASK-1", role: "build" },
            ownership: {
              state: "saved",
              target: {
                kind: "task",
                record: { ...session, role: "build", selectedModel: null },
                runtimeSession: { ...session, status: "idle" },
              },
            },
          }),
        }));
        connection.startupAttempts.setInstruction(id, { state: "accepted" });
        await connection.startupAttempts.complete(id);
        return { ...session, postStartActionError: null };
      });
      const onBackgroundTransfer = mock((_attemptId: string) => {});
      const openTaskView = mock<OpenTaskView>(() => {});
      const feedback = createFeedbackFake();
      const connection = createTestClientConnection({
        feedback,
        client: {
          workspaceGetRepoConfig: async () =>
            repoConfigSchema.parse({
              workspaceId: "workspace-1",
              workspaceName: "Workspace",
              repoPath: "/repo",
              agentStudioState: { openTaskIds: [] },
            }),
        },
      });
      const live = createStartupLiveSourceFake(connection.queryClient);
      const harness = createRuntimeHookHarness(
        useTaskSessionStartFlow,
        createArgs({
          sessions: [session],
          runSessionStartWorkflow,
          openTaskView,
          onBackgroundTransfer,
        }),
        {
          connection,
          runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({
            availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            loadRepoRuntimeCatalog: async () => ({}),
          }),
        },
      );
      let feedbackSubmission!: Promise<void>;
      let feedbackSettled = false;
      await harness.mount();
      try {
        await harness.run((flow) => flow.onHumanRequestChanges("TASK-1"));
        await harness.run((flow) => {
          flow.humanReviewFeedbackModal?.onMessageChange("Rename the export button.");
        });
        await harness.run((flow) => {
          feedbackSubmission = flow.humanReviewFeedbackModal!.onConfirm();
          void feedbackSubmission.then(() => {
            feedbackSettled = true;
          });
        });
        await harness.waitFor((flow) => Boolean(flow.sessionStartModal?.kickoffPrompt));
        await harness.run((flow) => {
          const start = flow.sessionStartModal!;
          void start.onConfirm({
            startMode: "reuse",
            sourceSessionOptionValue: start.existingSessionOptions[0]!.value,
            runInBackground: transfer === "submit",
          });
        });
        if (transfer === "continue")
          await harness.run((flow) => {
            flow.sessionStartModal?.onContinueInBackground();
          });

        expect(feedback.shownOf("error")).toEqual([]);
        expect(runSessionStartWorkflow).toHaveBeenCalledTimes(1);
        const launch = runSessionStartWorkflow.mock.calls[0]![0];
        const attemptId = launch.startupAttemptId;
        if (!attemptId) throw new Error("The launch must name its startup attempt.");
        expect(onBackgroundTransfer.mock.calls).toEqual([[attemptId]]);
        expect(connection.startupAttempts.getAttempt(attemptId)?.presentation).toBe("notification");
        expect(harness.getLatest().sessionStartModal).toBeNull();
        expect(harness.getLatest().humanReviewFeedbackModal).toMatchObject({
          message: "Rename the export button.",
          isSubmitting: true,
        });
        expect(feedbackSettled).toBe(false);
        expect(openTaskView).not.toHaveBeenCalled();

        await harness.run(() => pending.resolve());
        await feedbackSubmission;
        expect(runSessionStartWorkflow).toHaveBeenCalledTimes(1);
        expect(connection.startupAttempts.isReadyForHandoff(attemptId)).toBe(true);
        expect(openTaskView).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
        await harness.unmount();
        await connection.dispose();
      }
    },
  );
});
