import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { mapToKanbanColumns } from "@openducktor/workflows";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import {
  createTaskWorkflowActionsFixture,
  toWireTaskCard,
} from "@/test-utils/shared-test-fixtures";
import { QueryProvider } from "@/test-utils/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KanbanColumn } from "./kanban-column";

describe("mixed workflow Kanban", () => {
  test("renders shared and empty lanes from production host reads in explicit host order", async () => {
    const fixture = createSharedBoardWorkflows();
    const cards = fixture.workflows.map((workflow) =>
      createWorkflowTaskCardFixture(workflow, fixture.board, {
        id: `${workflow.definition.id}-1`,
        title: `${workflow.definition.id} story`,
        status: "shared_review",
      }),
    );
    const connection = createTestClientConnection({
      client: {
        workflowCatalogGet: async () => fixture.catalog,
        workspaceWorkflowGet: async () => ({
          hostInstanceId: fixture.catalog.hostInstanceId,
          board: fixture.board,
          workflows: fixture.workflows.map(({ reference }) => reference),
          newTaskWorkflow: fixture.workflows[0]!.reference,
        }),
        tasksList: async () => cards.map(toWireTaskCard),
      },
    });
    const { tasks } = await connection.queryClient.fetchQuery(
      repoTaskDataQueryOptions({ workspaceId: "workspace-1", repoPath: "/repo" }),
    );
    const columns = mapToKanbanColumns(tasks, fixture.board);
    const workflowActions = createTaskWorkflowActionsFixture();
    const noop = () => {};
    const view = render(
      <QueryProvider connection={connection}>
        <MemoryRouter>
          <TooltipProvider>
            <TaskWorkflowActionsContext value={workflowActions}>
              {columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  taskSessionsByTaskId={new Map()}
                  historicalSessionsByTaskId={new Map()}
                  mergedTargetByTaskId={new Map()}
                  autoCloseFailureByTaskId={new Map()}
                  activeTaskSessionContextByTaskId={new Map()}
                  taskActivityStateByTaskId={new Map(tasks.map(({ id }) => [id, "idle"]))}
                  onOpenDetails={noop}
                />
              ))}
            </TaskWorkflowActionsContext>
          </TooltipProvider>
        </MemoryRouter>
      </QueryProvider>,
    );
    try {
      expect(
        [...view.container.querySelectorAll("[data-kanban-lane-id]")].map((lane) =>
          lane.getAttribute("data-kanban-lane-id"),
        ),
      ).toEqual(fixture.board.states.map(({ id }) => id));
      const review = view.getByRole("region", { name: "Review lane" });
      expect(review.querySelectorAll("article[data-kanban-task-id]")).toHaveLength(2);
      expect(review.textContent).toContain("alpha story");
      expect(review.textContent).toContain("beta story");
      expect(view.getAllByRole("region", { name: "Writing lane" })).toHaveLength(2);
    } finally {
      view.unmount();
      await connection.dispose();
    }
  });
});
