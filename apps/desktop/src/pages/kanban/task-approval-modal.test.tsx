import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskApprovalModalModel } from "./kanban-page-model-types";

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogDescription: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("p", props, children),
  DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("h2", props, children),
}));

const noop = () => {};

const createModel = (overrides: Partial<TaskApprovalModalModel> = {}): TaskApprovalModalModel => ({
  open: true,
  stage: "complete_direct_merge",
  taskId: "TASK-1",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "manual",
  pullRequestAvailable: true,
  pullRequestUnavailableReason: null,
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequestUrl: null,
  title: "Ship direct merge flow",
  body: "Task description",
  targetBranch: { remote: "origin", branch: "beta" },
  publishTarget: { remote: "origin", branch: "beta" },
  isSubmitting: false,
  errorMessage: null,
  onOpenChange: noop,
  onModeChange: noop,
  onMergeMethodChange: noop,
  onPullRequestDraftModeChange: noop,
  onTitleChange: noop,
  onBodyChange: noop,
  onConfirm: noop,
  onSkipDirectMergeCompletion: noop,
  onCompleteDirectMerge: noop,
  ...overrides,
});

describe("TaskApprovalModal", () => {
  let TaskApprovalModal: typeof import("./task-approval-modal").TaskApprovalModal;

  beforeAll(async () => {
    ({ TaskApprovalModal } = await import("./task-approval-modal"));
  });

  test("renders explicit completion copy for merged local branches", () => {
    const html = renderToStaticMarkup(createElement(TaskApprovalModal, { model: createModel() }));

    expect(html).toContain("Publish And Mark Done");
    expect(html).toContain("Local merge ready");
    expect(html).toContain("Push beta And Mark Done");
    expect(html).toContain("Finish later to keep the task in Human Review");
  });

  test("shows a loading label while direct merge completion is pending", () => {
    const html = renderToStaticMarkup(
      createElement(TaskApprovalModal, {
        model: createModel({ isSubmitting: true }),
      }),
    );

    expect(html).toContain("Publishing beta");
    expect(html).toContain("animate-spin");
  });

  test("shows a loading indicator for approval submission actions", () => {
    const html = renderToStaticMarkup(
      createElement(TaskApprovalModal, {
        model: createModel({
          stage: "approval",
          isSubmitting: true,
          publishTarget: null,
        }),
      }),
    );

    expect(html).toContain("Merge Locally");
    expect(html).toContain("animate-spin");
  });

  test("fails fast when direct-merge completion branch context is missing", () => {
    const html = renderToStaticMarkup(
      createElement(TaskApprovalModal, {
        model: createModel({
          targetBranch: null,
          publishTarget: null,
        }),
      }),
    );

    expect(html).toContain(
      "Missing target branch for direct-merge completion. Refresh approval context and retry.",
    );
    expect(html).not.toContain("the target branch");
    expect(html).not.toContain("Local merge ready");
  });
});
