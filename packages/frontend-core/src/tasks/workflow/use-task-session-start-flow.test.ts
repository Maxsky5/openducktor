import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import type { RunSessionStartWorkflow } from "../../sessions/start/session-start-orchestration";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createRuntimeHookHarness } from "../../test-support/runtime-hook-harness";
import {
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
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
  onPostStartMessageFailure: () => {},
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
});
