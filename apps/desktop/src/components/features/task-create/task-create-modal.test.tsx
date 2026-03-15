import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";

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

mock.module("@/components/features/task-create", () => ({
  TaskCreateDiscardDialog: () => null,
  useTaskCreateModalController: () => controllerMock,
}));

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  DialogContent: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement("p", {}, children),
  DialogFooter: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement("h2", {}, children),
}));

describe("TaskCreateModal", () => {
  let TaskCreateModal: typeof import("./task-create-modal").TaskCreateModal;

  beforeAll(async () => {
    ({ TaskCreateModal } = await import("./task-create-modal"));
  });

  test("renders the edit modal shell for the document editor flow", async () => {
    const task = { id: "TASK-123" } as TaskCard;
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(TaskCreateModal, {
          open: true,
          onOpenChange: () => {},
          tasks: [task],
          task,
        }),
      );
    });

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain("Edit Task");
    expect(tree).toContain("Markdown");
    expect(tree).toContain("Preview");
    expect(tree).toContain("Save Spec");

    await act(async () => {
      renderer.unmount();
    });
  });
});
