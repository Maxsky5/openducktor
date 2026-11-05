import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import { useQuery } from "@tanstack/react-query";
import { taskWorkflowDescriptor } from "@openducktor/workflows";
import type { PropsWithChildren } from "react";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createDeferred, toWireTaskCard } from "../../test-support/shared-test-fixtures";
import { useTaskActionTasks } from "../../queries/use-task-action-tasks";
import { taskQueryKeys, unfilteredRepoTaskDataQueryOptions } from "../../queries/tasks";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import { draftHasMeaningfulContent } from "../../drafts/agent-chat-composer-draft";
import { useWorkflowEventActions } from "./use-workflow-event-actions";

test("plain workflow events block duplicate taps and leave view updates to the task stream", async () => {
  const { alpha, beta, board, catalog } = createSharedBoardWorkflows();
  const before = createWorkflowTaskCardFixture(alpha, board, {
    id: "task-alpha",
    status: "shared_review",
  });
  const after = toWireTaskCard(
    createWorkflowTaskCardFixture(alpha, board, {
      id: before.id,
      status: "alpha_hold",
    }),
  );
  const saved = createDeferred<typeof after>();
  const apply = mock(() => saved.promise);
  const feedback = createFeedbackFake();
  const launch = mock(() => {});
  const list = mock(async () => [after]);
  const connection = createTestClientConnection({
    feedback,
    client: {
      workflowCatalogGet: async () => catalog,
      workspaceWorkflowGet: async () => ({
        hostInstanceId: "mixed-host",
        board,
        workflows: [alpha.reference, beta.reference],
        newTaskWorkflow: alpha.reference,
      }),
      taskApplyEvent: apply,
      tasksList: list,
    },
  });
  connection.queryClient.setQueryData(
    taskQueryKeys.unfilteredRepoData({ workspaceId: "workspace", repoPath: "/repo" }),
    {
      tasks: [before],
    },
  );
  const harness = createHookHarness(
    () =>
      useWorkflowEventActions(
        "/repo",
        useTaskActionTasks({ workspaceId: "workspace", repoPath: "/repo" }, []),
        launch,
        "workspace",
      ),
    undefined,
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
      ),
    },
  );
  try {
    await harness.mount();
    await harness.run((actions) => {
      actions.onApplyEvent(before.id, "alpha_hold", []);
      actions.onApplyEvent(before.id, "alpha_hold", []);
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      { workspaceId: "workspace", repoPath: "/repo" },
      before.id,
      "alpha_hold",
    );
    expect(feedback.shownOf("info")[0]?.message).toBe("Updating task");
    await harness.run(() => saved.resolve(after));
    await harness.waitFor(() => feedback.dismissed.length === 1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(feedback.shownOf("error")).toEqual([]);
  } finally {
    await harness.unmount();
    await connection.dispose();
  }
});

test.each([
  { outcome: "success", observed: false },
  { outcome: "success", observed: true },
  { outcome: "denied", observed: false },
  { outcome: "changed_workflow", observed: false },
] as const)(
  "plain events retain their following launch without a task reread: %j",
  async ({ outcome, observed }) => {
    const { alpha, beta, board, catalog } = createSharedBoardWorkflows();
    const before = createWorkflowTaskCardFixture(alpha, board, {
      id: "event-task",
      status: "shared_review",
    });
    const after = toWireTaskCard(
      createWorkflowTaskCardFixture(outcome === "changed_workflow" ? beta : alpha, board, {
        id: before.id,
        status: "shared_review",
      }),
    );
    const feedback = createFeedbackFake();
    const launch = mock(() => {});
    const apply = mock(async () => {
      if (outcome === "denied") throw new Error("Host denied event");
      return after;
    });
    const list = mock(async () => [after]);
    const listAll = mock(async () => [after]);
    const connection = createTestClientConnection({
      feedback,
      client: {
        taskApplyEvent: apply,
        tasksList: list,
        tasksListAll: listAll,
        workflowCatalogGet: async () => ({
          ...catalog,
          workflows: [taskWorkflowDescriptor(alpha), taskWorkflowDescriptor(beta)],
        }),
        workspaceWorkflowGet: async () => ({
          hostInstanceId: "mixed-host",
          board,
          workflows: [alpha.reference, beta.reference],
          newTaskWorkflow: before.workflow,
        }),
      },
    });
    connection.queryClient.setQueryData(
      taskQueryKeys.unfilteredRepoData({ workspaceId: "workspace", repoPath: "/repo" }),
      {
        tasks: [before],
      },
    );
    const harness = createHookHarness(
      () => {
        useQuery({
          ...unfilteredRepoTaskDataQueryOptions({ workspaceId: "workspace", repoPath: "/repo" }),
          enabled: observed,
        });
        return useWorkflowEventActions("/repo", [before], launch, "workspace");
      },
      undefined,
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );
    try {
      await harness.mount();
      await harness.run((flow) =>
        flow.onApplyEvent(before.id, "alpha_submit", ["alpha_write_start"]),
      );
      await harness.waitFor(() => feedback.dismissed.length > 0);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(list).not.toHaveBeenCalled();
      expect(listAll).not.toHaveBeenCalled();
      if (outcome === "success")
        expect(launch).toHaveBeenCalledWith(
          before.id,
          "alpha_write_start",
          expect.objectContaining({ status: "shared_review" }),
        );
      else {
        expect(launch).not.toHaveBeenCalled();
        expect(feedback.shownOf("error")[0]?.options?.description).toContain(
          outcome === "denied" ? "Host denied" : "Do not repeat the task action",
        );
      }
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  },
);

test.each([{ outcome: "terminal" }, { outcome: "nonterminal" }, { outcome: "denied" }] as const)(
  "workflow draft cleanup follows the host result: %j",
  async ({ outcome }) => {
    const { alpha, beta, board, catalog } = createSharedBoardWorkflows();
    const eventId = outcome === "nonterminal" ? "alpha_hold" : "alpha_approve";
    const before = createWorkflowTaskCardFixture(alpha, board, {
      id: "draft-task",
      status: "alpha_approval",
      artifactSummary: {
        ...alpha.emptyArtifactSummary(),
        alpha_review: { present: true, verdict: "accept" },
      },
    });
    const after = toWireTaskCard(
      createWorkflowTaskCardFixture(alpha, board, {
        ...toWireTaskCard(before),
        status: outcome === "nonterminal" ? "alpha_hold" : "shared_done",
      }),
    );
    const session = {
      externalSessionId: "writer-session",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/task",
      role: "alpha_writer",
      startedAt: "2026-11-01T00:00:00.000Z",
      selectedModel: null,
    };
    const saved = createDeferred<typeof after>();
    const mutation = mock(() => saved.promise);
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      feedback,
      scheduleTask: () => () => {},
      client: {
        workflowCatalogGet: async () => ({
          ...catalog,
          workflows: [taskWorkflowDescriptor(alpha), taskWorkflowDescriptor(beta)],
        }),
        workspaceWorkflowGet: async () => ({
          hostInstanceId: "mixed-host",
          board,
          workflows: [alpha.reference, beta.reference],
          newTaskWorkflow: before.workflow,
        }),
        taskApplyEvent: mutation,
        tasksList: async () => [after],
        agentSessionsListForTasks: async (_repo, ids) =>
          ids.map((taskId) => ({ taskId, agentSessions: [session] })),
      },
    });
    const identity = { workspaceId: "workspace", ...session };
    const draft = {
      segments: [{ id: "text", kind: "text" as const, text: "Unsent instructions" }],
      attachments: [
        { id: "attachment", kind: "pdf" as const, name: "notes.pdf", path: "/repo/notes.pdf" },
      ],
    };
    connection.drafts.chat.set(identity, before.id, draft);
    await connection.drafts.chat.flush(identity);
    const impact = taskStopImpactQueryKeys.get(
      { workspaceId: "workspace", repoPath: "/repo" },
      [before.id],
      "close",
    );
    connection.queryClient.setQueryData(impact, {});
    const harness = createHookHarness(
      () => useWorkflowEventActions("/repo", [before], () => {}, "workspace"),
      undefined,
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );
    await harness.mount();
    try {
      await harness.run((flow) => flow.onApplyEvent(before.id, eventId, []));
      await harness.waitFor(() => mutation.mock.calls.length === 1);
      expect(connection.drafts.chat.hydrate(identity, before.id)).toEqual(draft);
      await harness.run(() => {
        if (outcome === "denied") saved.reject(new Error("Host denied action"));
        else saved.resolve(after);
      });
      await harness.waitFor(() => feedback.dismissed.length > 0);
      expect(mutation).toHaveBeenCalledTimes(1);
      const stored = connection.drafts.chat.hydrate(identity, before.id);
      if (outcome === "terminal") {
        expect(draftHasMeaningfulContent(stored)).toBe(false);
      } else expect(stored).toEqual(draft);
      expect(connection.queryClient.getQueryState(impact)?.isInvalidated).toBe(
        outcome !== "nonterminal",
      );
      expect(feedback.shownOf("error")).toHaveLength(outcome === "denied" ? 1 : 0);
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  },
);
