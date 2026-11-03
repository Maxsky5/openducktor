import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import { useQuery } from "@tanstack/react-query";
import { workflowDefinitionSchema } from "@openducktor/contracts";
import type { PropsWithChildren } from "react";
import {
  createTaskWorkflow,
  taskWorkflowDescriptor,
  workflowRoleCatalog,
} from "@openducktor/workflows";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { taskQueryKeys, unfilteredRepoTaskDataQueryOptions } from "../../queries/tasks";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { toWireTaskCard } from "../../test-support/shared-test-fixtures";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createHumanReviewFeedbackState } from "./human-review-feedback-state";
import { requestHumanReviewChanges, submitHumanReviewFeedback } from "./human-review-feedback-flow";
import { useTaskWorkflowContinuation } from "./task-workflow-continuation";

test.each([false, true])(
  "Request Changes uses its committed card and one refresh, observed=%s",
  async (observed) => {
    const { alpha: original, beta, board, catalog } = createSharedBoardWorkflows();
    const definition = workflowDefinitionSchema.parse(original.definition);
    definition.events = definition.events.map((event) =>
      event.id === "alpha_revise" ? { ...event, effect: "review.request_changes" } : event,
    );
    const alpha = createTaskWorkflow(
      definition,
      original.workflowTemplates,
      workflowRoleCatalog([original]),
    );
    const before = createWorkflowTaskCardFixture(alpha, board, { status: "shared_review" });
    const after = toWireTaskCard(
      createWorkflowTaskCardFixture(alpha, board, {
        ...toWireTaskCard(before),
        status: "alpha_work",
        artifactSummary: {
          ...alpha.emptyArtifactSummary(),
          alpha_review: { present: true, verdict: "revise" },
        },
      }),
    );
    const feedback = createFeedbackFake();
    const launch = mock(() => {});
    const requestChanges = mock(async () => after);
    const list = mock(async () => [after]);
    const listAll = mock(async () => [after]);
    const connection = createTestClientConnection({
      feedback,
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
        humanRequestChanges: requestChanges,
        tasksList: list,
        tasksListAll: listAll,
      },
    });
    connection.queryClient.setQueryData(
      taskQueryKeys.unfilteredRepoData({ workspaceId: "workspace", repoPath: "/repo" }),
      {
        tasks: [before],
      },
    );
    const state = createHumanReviewFeedbackState([before], before.id, undefined, true, {
      workflow: before.workflow,
      launchActionIds: ["alpha_write_start", "alpha_write_revise"],
    });
    state.message = "  Revise the draft.  ";
    const harness = createHookHarness(
      () => {
        useQuery({
          ...unfilteredRepoTaskDataQueryOptions({ workspaceId: "workspace", repoPath: "/repo" }),
          enabled: observed,
        });
        const continueTaskWorkflow = useTaskWorkflowContinuation(
          { workspaceId: "workspace", repoPath: "/repo" },
          launch,
        );
        return () =>
          submitHumanReviewFeedback({
            feedback,
            state,
            continueTaskWorkflow,
            requestChangesTask: (taskId, note) =>
              requestHumanReviewChanges(
                connection.queryClient,
                { workspaceId: "workspace", repoPath: "/repo" },
                taskId,
                note,
              ),
            builderSessions: [],
            startRequestChangesSession: async () => {
              throw new Error("Continuation must own the launch.");
            },
          });
      },
      undefined,
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );
    await harness.mount();
    try {
      await harness.run(async (submit) => {
        await submit();
      });
      expect(feedback.shownOf("error")).toEqual([]);
      expect(requestChanges).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenCalledWith(
        before.id,
        "alpha_write_revise",
        expect.objectContaining({ status: "alpha_work" }),
        "Revise the draft.",
      );
      expect(list).toHaveBeenCalledTimes(1);
      expect(listAll).toHaveBeenCalledTimes(observed ? 1 : 0);
    } finally {
      await harness.unmount();
      await connection.dispose();
    }
  },
);
