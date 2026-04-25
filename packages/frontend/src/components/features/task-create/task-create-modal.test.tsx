import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { act, createElement, type ReactNode } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const controllerMock = {
  mode: "edit" as const,
  onDialogOpenChange: (_open: boolean) => {},
  isBusy: false,
  step: "details" as const,
  setStep: (_step: "type" | "details") => {},
  editSection: "spec" as const,
  isSpecDirty: false,
  isPlanDirty: false,
  requestSectionChange: (_section: "details" | "spec" | "plan") => {},
  isTypeStepVisible: false,
  selectedCreateIssueType: "task" as const,
  selectCreateIssueType: (_issueType: string) => {},
  activeDocumentSection: "spec" as const,
  activeDraft: "# Spec",
  views: {
    spec: "split" as const,
    plan: "split" as const,
  },
  setDocumentView: (_section: "spec" | "plan", _view: "write" | "split" | "preview") => {},
  activeDocument: {
    updatedAt: null,
    isLoading: false,
    error: null,
    loaded: true,
  },
  isSavingDocument: null as "spec" | "plan" | null,
  isActiveDocumentDirty: false,
  updateDocumentDraft: (_section: "spec" | "plan", _value: string) => {},
  loadDocumentSection: async (_section: "spec" | "plan", _force?: boolean) => {},
  state: {
    title: "Task",
  },
  priorityComboboxOptions: [],
  knownLabels: [],
  updateState: (_patch: unknown) => {},
  footerError: null,
  isEditingDocument: true,
  close: () => {},
  discardCurrentDocumentDraft: () => {},
  taskId: "TASK-123",
  saveActiveDocument: async () => {},
  isSubmitting: false,
  submit: async () => {},
  pendingDiscardIntent: null,
  clearPendingDiscardIntent: () => {},
  confirmDiscard: () => {},
};

describe("TaskCreateModal", () => {
  let TaskCreateModal: typeof import("./task-create-modal").TaskCreateModal;

  beforeEach(async () => {
    mock.module("@/components/features/task-create/task-create-discard-dialog", () => ({
      TaskCreateDiscardDialog: () => null,
    }));
    mock.module("@/components/features/task-create/use-task-create-modal-controller", () => ({
      useTaskCreateModalController: () => controllerMock,
    }));
    mock.module("@/components/features/task-composer/task-document-editor", () => ({
      TaskDocumentEditor: () => createElement("div", null, "Mock task document editor"),
    }));
    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", null, children),
      DialogBody: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", null, children),
      DialogContent: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", null, children),
      DialogDescription: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("p", null, children),
      DialogFooter: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", null, children),
      DialogHeader: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", null, children),
      DialogTitle: ({ children }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("h2", null, children),
    }));
    ({ TaskCreateModal } = await import("./task-create-modal"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      [
        "@/components/features/task-create/task-create-discard-dialog",
        () => import("./task-create-discard-dialog"),
      ],
      [
        "@/components/features/task-create/use-task-create-modal-controller",
        () => import("./use-task-create-modal-controller"),
      ],
      [
        "@/components/features/task-composer/task-document-editor",
        () => import("@/components/features/task-composer/task-document-editor"),
      ],
      ["@/components/ui/dialog", () => import("@/components/ui/dialog")],
    ]);
  });

  test("renders the edit modal shell for the document editor flow", async () => {
    const task = { id: "TASK-123" } as TaskCard;
    const rendered = render(
      createElement(TaskCreateModal, {
        open: true,
        onOpenChange: () => {},
        tasks: [task],
        task,
      }),
    );

    expect(rendered.container.textContent).toContain("Edit Task");
    expect(rendered.container.textContent).toContain("Markdown");
    expect(rendered.container.textContent).toContain("Preview");
    expect(rendered.container.textContent).toContain("Save Spec");

    await act(async () => {
      rendered.unmount();
    });
  });
});
