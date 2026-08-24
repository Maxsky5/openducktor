import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ComposerState } from "@/types/task-composer";
import { render, screen } from "@testing-library/react";
import { act, createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import * as taskCreateModalControllerModule from "./use-task-create-modal-controller";

enableReactActEnvironment();

const realTaskCreateModalControllerModule = { ...taskCreateModalControllerModule };

const noDocumentSaveInProgress = (): "spec" | "plan" | null => null;
const noFooterError = (): string | null => null;

const controllerMock = {
  mode: "edit",
  onDialogOpenChange: (_open: boolean) => {},
  isBusy: false,
  isFormDisabled: false,
  isRecoveryBlocked: false,
  hasExternalTaskConflict: false,
  step: "details",
  setStep: (_step: "type" | "details") => {},
  editSection: "spec",
  isSpecDirty: false,
  isPlanDirty: false,
  requestSectionChange: (_section: "details" | "spec" | "plan") => {},
  isTypeStepVisible: false,
  selectedCreateIssueType: "task",
  selectCreateIssueType: (_issueType: string) => {},
  activeDocumentSection: "spec",
  activeDraft: "# Spec",
  views: {
    spec: "split",
    plan: "split",
  },
  setDocumentView: (_section: "spec" | "plan", _view: "write" | "split" | "preview") => {},
  activeDocument: {
    updatedAt: null,
    isLoading: false,
    error: null,
    loaded: true,
  },
  isSavingDocument: noDocumentSaveInProgress(),
  isActiveDocumentDirty: false,
  updateDocumentDraft: (_section: "spec" | "plan", _value: string) => {},
  loadDocumentSection: async (_section: "spec" | "plan", _force?: boolean) => {},
  state: {
    title: "Task",
  },
  priorityComboboxOptions: [],
  knownLabels: [],
  updateState: (_patch: Partial<ComposerState>) => {},
  footerError: noFooterError(),
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
        async () => realTaskCreateModalControllerModule,
      ],
      [
        "@/components/features/task-composer/task-document-editor",
        () => import("@/components/features/task-composer/task-document-editor"),
      ],
    ]);
  });

  test("renders the edit modal shell for the document editor flow", async () => {
    const task = createTaskCardFixture({ id: "TASK-123" });
    const rendered = render(
      createElement(TaskCreateModal, {
        open: true,
        onOpenChange: () => {},
        tasks: [task],
        task,
      }),
    );

    expect(await screen.findByText("Edit Task")).toBeTruthy();
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Save Spec")).toBeTruthy();

    await act(async () => {
      rendered.unmount();
    });
  });

  test("locks mutation controls but keeps Close available after partial state", async () => {
    controllerMock.isRecoveryBlocked = true;
    controllerMock.isFormDisabled = true;
    controllerMock.isEditingDocument = false;
    controllerMock.footerError =
      "Refresh before continuing. Task: created-task · Phase: compensate_create · Durable state: created_partial";
    const task = createTaskCardFixture({ id: "TASK-123" });

    try {
      const rendered = render(
        createElement(TaskCreateModal, {
          open: true,
          onOpenChange: () => {},
          tasks: [task],
          task,
        }),
      );

      expect(await screen.findByText(/created-task/)).toBeTruthy();
      const closeButton = screen
        .getAllByRole<HTMLButtonElement>("button", { name: "Close" })
        .find((button) => button.textContent === "Close");
      expect(closeButton?.disabled).toBe(false);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" }).disabled).toBe(
        true,
      );
      await act(async () => rendered.unmount());
    } finally {
      controllerMock.isRecoveryBlocked = false;
      controllerMock.isFormDisabled = false;
      controllerMock.isEditingDocument = true;
      controllerMock.footerError = null;
    }
  });

  test("blocks task save but keeps the local draft available after an external change", async () => {
    controllerMock.hasExternalTaskConflict = true;
    controllerMock.isEditingDocument = false;
    controllerMock.footerError =
      "This task changed while you were editing. Close and reopen it to load the latest version before saving.";
    const task = createTaskCardFixture({ id: "TASK-123" });

    try {
      const rendered = render(
        createElement(TaskCreateModal, {
          open: true,
          onOpenChange: () => {},
          tasks: [task],
          task,
        }),
      );

      expect(await screen.findByText(/changed while you were editing/)).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" }).disabled).toBe(
        true,
      );
      await act(async () => rendered.unmount());
    } finally {
      controllerMock.hasExternalTaskConflict = false;
      controllerMock.isEditingDocument = true;
      controllerMock.footerError = null;
    }
  });
});
