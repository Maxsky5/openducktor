import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";

const sheetContentRenderMock = mock(
  (_props: {
    children: ReactNode;
    closeButton?: unknown;
    visualOverlay?: boolean;
    className?: string;
    side?: string;
  }) => null,
);

mock.module("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetContent: (props: Parameters<typeof sheetContentRenderMock>[0]) => {
    sheetContentRenderMock(props);
    return createElement("div", null, props.children);
  },
  SheetDescription: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetTitle: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const viewModelMock = {
  taskId: "TASK-1",
  subtasks: [],
  shouldRenderSubtasks: false,
  taskLabels: [],
  specDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
  planDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
  qaDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
  hasSpecDocument: false,
  hasPlanDocument: false,
  hasQaDocument: false,
  specSummaryUpdatedAt: null,
  planSummaryUpdatedAt: null,
  qaSummaryUpdatedAt: null,
  runWorkflowAction: () => {},
  loadSpecDocumentSection: () => {},
  loadPlanDocumentSection: () => {},
  loadQaDocumentSection: () => {},
  isDeleteDialogOpen: false,
  isDeletePending: false,
  deleteError: null,
  hasManagedSessionCleanup: false,
  managedWorktreeCount: 0,
  impactError: null,
  openDeleteDialog: () => {},
  closeDeleteDialog: () => {},
  handleDeleteDialogOpenChange: () => {},
  confirmDelete: () => {},
};

mock.module("./use-task-details-sheet-view-model", () => ({
  useTaskDetailsSheetViewModel: () => viewModelMock,
}));

describe("TaskDetailsSheet", () => {
  test("renders without the top-right close control", async () => {
    sheetContentRenderMock.mockClear();
    const { TaskDetailsSheet } = await import("./task-details-sheet");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheet, {
        task,
        allTasks: [task],
        open: true,
        onOpenChange: () => {},
      }),
    );

    expect(html).not.toContain('<span class="sr-only">Close</span>');
    expect(sheetContentRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        closeButton: null,
        visualOverlay: true,
      }),
    );
  });
});
