import { specPlanBuildWorkflow } from "@openducktor/workflows";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ComposerState } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import type { TaskCreateWorkspacePicker } from "@openducktor/frontend-core/tasks/create/use-task-create-workspace";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import * as taskDetailsFormModule from "@/components/features/task-composer/task-details-form";
import * as taskCreateModalControllerModule from "./use-task-create-modal-controller";

enableReactActEnvironment();

const taskCreateDiscardDialogModule = await import("./task-create-discard-dialog");
const taskDocumentEditorModule =
  await import("@/components/features/task-composer/task-document-editor");
let testSpies: Array<{ mockRestore(): void }> = [];

const noDocumentSaveInProgress = (): "spec" | "plan" | null => null;
const noFooterError = (): string | null => null;

const emptyDocument = {
  serverMarkdown: "",
  draftMarkdown: "",
  updatedAt: null,
  isLoading: false,
  loaded: true,
  error: null,
};

const workspacePickerFixture = (
  overrides: Partial<TaskCreateWorkspacePicker> = {},
): TaskCreateWorkspacePicker => ({
  target: null,
  selected: null,
  choices: [],
  canChange: false,
  isLocked: false,
  blockedReason: null,
  select: () => {},
  removeImages: () => {},
  ...overrides,
});

const controllerMock: ReturnType<
  typeof taskCreateModalControllerModule.useTaskCreateModalController
> = {
  taskWorkflow: specPlanBuildWorkflow,
  issueTypeChoices: specPlanBuildWorkflow.definition.issueTypes.map(
    ({ id, label, description, icon }) => ({
      value: id,
      label,
      description: description ?? "",
      guidance: description ?? "",
      icon,
    }),
  ),
  workflowRead: {
    taskWorkflow: specPlanBuildWorkflow,
    pending: false,
    error: null,
    retry: async () => {},
  },
  mode: "edit",
  workspaceId: "workspace-1",
  workspaceRepoPath: "/workspace/repo",
  onDialogOpenChange: (_open: boolean) => {},
  isBusy: false,
  isFormDisabled: false,
  isRecoveryBlocked: false,
  isSaveOrRecoveryLocked: false,
  step: "details",
  setStep: (_step: "type" | "details") => {},
  editSection: { artifactCode: "spec" },
  isTaskDraftDirty: false,
  dirtyDocuments: { spec: false, plan: false },
  requestSectionChange: (
    _section: import("@openducktor/frontend-core/tasks/create/task-composer-types").EditTaskSection,
  ) => {},
  isTypeStepVisible: false,
  selectedCreateIssueType: "task",
  selectCreateIssueType: (_issueType: string) => {},
  activeDocumentSection: "spec",
  activeDraft: "# Spec",
  views: {
    spec: "split",
    plan: "split",
  },
  setDocumentView: (_section: string, _view: "write" | "split" | "preview") => {},
  activeDocument: { ...emptyDocument },
  documents: {
    spec: { ...emptyDocument },
    plan: { ...emptyDocument },
  },
  isSavingDocument: noDocumentSaveInProgress(),
  isActiveDocumentDirty: false,
  updateDocumentDraft: (_section: string, _value: string) => {},
  loadDocumentSection: async (_section: string, _force?: boolean) => {},
  state: {
    issueType: "task",
    removeWorktreeOnClose: null,
    title: "Task",
    priority: 2,
    description: "",
    labels: [],
  },
  priorityOptions: [],
  knownLabels: [],
  updateState: (_patch: Partial<ComposerState>) => {},
  footerError: noFooterError(),
  footerErrorOutcomeUnknown: false,
  workspacePicker: null,
  destinationError: noFooterError(),
  isEditingDocument: true,
  close: async () => {},
  discardCurrentDocumentDraft: () => {},
  taskId: "TASK-123",
  saveActiveDocument: async () => {},
  isSubmitting: false,
  submit: async () => {},
  pendingDiscardIntent: null,
  clearPendingDiscardIntent: () => {},
  confirmDiscard: async () => {},
  stageDescriptionImage: async () => {
    throw new Error("Image staging is not used in this test.");
  },
  descriptionAssetUploads: [],
  descriptionAssetPreviews: new Map(),
};

let controllerForTest = controllerMock;

describe("TaskCreateModal", () => {
  let TaskCreateModal: typeof import("./task-create-modal").TaskCreateModal;

  beforeEach(async () => {
    testSpies = [
      spyOn(taskCreateDiscardDialogModule, "TaskCreateDiscardDialog").mockImplementation(() =>
        createElement("div", { "data-testid": "mock-task-create-discard-dialog" }),
      ),
      spyOn(taskCreateModalControllerModule, "useTaskCreateModalController").mockImplementation(
        () => controllerForTest,
      ),
      spyOn(taskDocumentEditorModule, "TaskDocumentEditor").mockImplementation(() =>
        createElement("div", null, "Mock task document editor"),
      ),
    ];
    ({ TaskCreateModal } = await import("./task-create-modal"));
  });

  afterEach(() => {
    for (const testSpy of testSpies) testSpy.mockRestore();
    testSpies = [];
    controllerForTest = controllerMock;
  });

  test("returns keyboard focus to the control that opened the task dialog", async () => {
    controllerForTest = {
      ...controllerMock,
      mode: "create",
      taskId: null,
      step: "type",
      isTypeStepVisible: true,
      activeDocumentSection: null,
      isEditingDocument: false,
    };
    const trigger = document.createElement("button");
    trigger.textContent = "New task";
    document.body.append(trigger);
    trigger.focus();
    const props = { open: true, onOpenChange: () => {}, tasks: [] };
    const rendered = render(createElement(TaskCreateModal, props));
    try {
      const dialog = screen.getByRole("dialog", { name: "Create task" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true), {
        timeout: 250,
      });
      await act(async () => {
        rendered.rerender(createElement(TaskCreateModal, { ...props, open: false }));
      });
      // Formatting DOM nodes on a failed poll can block the timer that restores focus.
      await waitFor(() => expect(document.activeElement === trigger).toBe(true), {
        timeout: 250,
      });
    } finally {
      await act(async () => rendered.unmount());
      trigger.remove();
    }
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

    expect(await screen.findByText("Edit task")).toBeTruthy();
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Save Spec")).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    const scrollRegion = dialog.querySelector("fieldset .overflow-y-auto");
    expect(scrollRegion?.closest("fieldset")?.classList.contains("min-h-0")).toBe(true);
    expect(scrollRegion?.closest("fieldset")?.classList.contains("flex")).toBe(true);

    await act(async () => {
      rendered.unmount();
    });
  });

  test("names the task workspace and blocks Create while that workspace is closed", async () => {
    controllerForTest = {
      ...controllerMock,
      mode: "create",
      taskId: null,
      editSection: "details",
      activeDocumentSection: null,
      isEditingDocument: false,
      workspacePicker: workspacePickerFixture({
        target: { workspaceId: "alpha", workspaceName: "Alpha" },
      }),
      destinationError: "Alpha is closed. Reopen it or pick another workspace to create this task.",
      footerError: "Alpha is closed. Reopen it or pick another workspace to create this task.",
    };
    testSpies.push(
      spyOn(taskDetailsFormModule, "TaskDetailsForm").mockImplementation(() =>
        createElement("div", null, "Mock task details form"),
      ),
    );
    const rendered = render(
      createElement(TaskCreateModal, { open: true, onOpenChange: () => {}, tasks: [] }),
    );

    expect(await screen.findByText("Create a task in Alpha.")).toBeTruthy();
    expect(
      screen.getByText("Alpha is closed. Reopen it or pick another workspace to create this task."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create task" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      rendered.unmount();
    });
  });

  test("tells apart workspaces with the same name by their repository", async () => {
    const alphaWork = createWorkspaceRecordFixture({
      workspaceId: "alpha-1",
      workspaceName: "Alpha",
      repoPath: "/work/alpha",
    });
    const alphaFork = createWorkspaceRecordFixture({
      workspaceId: "alpha-2",
      workspaceName: "Alpha",
      repoPath: "/forks/alpha",
    });
    controllerForTest = {
      ...controllerMock,
      mode: "create",
      taskId: null,
      editSection: "details",
      activeDocumentSection: null,
      isEditingDocument: false,
      workspaceId: "alpha-1",
      workspacePicker: workspacePickerFixture({
        target: { workspaceId: "alpha-1", workspaceName: "Alpha" },
        selected: alphaWork,
        choices: [alphaWork, alphaFork],
        canChange: true,
      }),
    };
    testSpies.push(
      spyOn(taskDetailsFormModule, "TaskDetailsForm").mockImplementation(() =>
        createElement("div", null, "Mock task details form"),
      ),
    );
    const rendered = render(
      createElement(TaskCreateModal, { open: true, onOpenChange: () => {}, tasks: [] }),
    );

    // The details step keeps the picker, so a closed workspace can be replaced from there. The
    // title line shows no path; the menu shows the repository of each workspace.
    const picker = await screen.findByRole("button", { name: "Workspace: Alpha" });
    expect(screen.queryByText("/work/alpha")).toBeNull();
    fireEvent.click(picker);
    expect(await screen.findByRole("option", { name: /\/work\/alpha/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /\/forks\/alpha/ })).toBeTruthy();

    await act(async () => {
      rendered.unmount();
    });
  });

  test("lets the type step pick the workspace while the workflow cannot load", async () => {
    const picked: string[] = [];
    let removedImages = 0;
    const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha", workspaceName: "Alpha" });
    const createStep = {
      ...controllerMock,
      mode: "create" as const,
      taskId: null,
      step: "type" as const,
      isTypeStepVisible: true,
      editSection: "details" as const,
      activeDocumentSection: null,
      isEditingDocument: false,
      isFormDisabled: true,
      workspaceId: "alpha",
      workspacePicker: workspacePickerFixture({
        target: { workspaceId: "alpha", workspaceName: "Alpha" },
        selected: alpha,
        choices: [
          alpha,
          createWorkspaceRecordFixture({ workspaceId: "beta", workspaceName: "Beta" }),
        ],
        canChange: true,
        select: (workspaceId) => {
          picked.push(workspaceId);
        },
      }),
    };
    controllerForTest = createStep;
    const rendered = render(
      createElement(TaskCreateModal, { open: true, onOpenChange: () => {}, tasks: [] }),
    );

    const picker = await screen.findByRole("button", { name: "Workspace: Alpha" });
    expect(picker.textContent).toContain("Alpha");
    expect(picker.closest("fieldset")).toBeNull();
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: /Beta/ }));
    expect(picked).toEqual(["beta"]);

    controllerForTest = {
      ...createStep,
      workspacePicker: {
        ...createStep.workspacePicker,
        canChange: false,
        blockedReason: "Description images belong to this workspace.",
        removeImages: () => {
          removedImages += 1;
        },
      },
    };
    rendered.rerender(
      createElement(TaskCreateModal, { open: true, onOpenChange: () => {}, tasks: [] }),
    );
    const blockedPicker = screen.getByRole("button", { name: "Workspace: Alpha" });
    expect(blockedPicker.hasAttribute("disabled")).toBe(true);
    const hint = document.getElementById(blockedPicker.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("Description images belong to this workspace.");
    fireEvent.click(screen.getByRole("button", { name: "Remove images" }));
    expect(removedImages).toBe(1);

    await act(async () => {
      rendered.unmount();
    });
  });

  test("shows a single open workspace as text, without a menu", async () => {
    const only = createWorkspaceRecordFixture({ workspaceId: "alpha", workspaceName: "Alpha" });
    controllerForTest = {
      ...controllerMock,
      mode: "create",
      taskId: null,
      step: "type",
      isTypeStepVisible: true,
      editSection: "details",
      activeDocumentSection: null,
      isEditingDocument: false,
      workspacePicker: workspacePickerFixture({
        target: { workspaceId: "alpha", workspaceName: "Alpha" },
        selected: only,
        choices: [only],
      }),
    };
    const rendered = render(
      createElement(TaskCreateModal, { open: true, onOpenChange: () => {}, tasks: [] }),
    );

    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Workspace: Alpha" })).toBeNull();

    await act(async () => {
      rendered.unmount();
    });
  });

  test("passes a linked issue's image context to the description form", async () => {
    controllerMock.isEditingDocument = false;
    controllerMock.editSection = "details";
    controllerMock.activeDocumentSection = null;
    const formSpy = spyOn(taskDetailsFormModule, "TaskDetailsForm").mockImplementation(() =>
      createElement("div", { "data-testid": "task-details-form" }),
    );
    testSpies.push(formSpy);
    const task = createTaskCardFixture({
      id: "TASK-123",
      sourceIssue: {
        providerId: "github",
        scope: "owner/repo",
        sourceId: "132",
        number: "132",
        url: "https://github.com/owner/repo/issues/132",
      },
    });

    try {
      const rendered = render(
        createElement(TaskCreateModal, {
          open: true,
          onOpenChange: () => {},
          tasks: [task],
          task,
        }),
      );
      try {
        expect(await screen.findByTestId("task-details-form")).toBeTruthy();
        expect(formSpy.mock.calls[0]?.[0].disabled).toBe(false);
        expect(formSpy.mock.calls[0]?.[0].issueImageContext).toEqual({
          workspaceId: "workspace-1",
          repoPath: "/workspace/repo",
          sourceId: "132",
          providerId: "github",
          taskId: "TASK-123",
        });
      } finally {
        await act(async () => rendered.unmount());
      }
    } finally {
      controllerMock.isEditingDocument = true;
      controllerMock.editSection = { artifactCode: "spec" };
      controllerMock.activeDocumentSection = "spec";
    }
  });

  test("keeps the description save lock clear during an image upload", async () => {
    controllerMock.isSubmitting = false;
    controllerMock.isSavingDocument = null;
    controllerMock.isRecoveryBlocked = false;
    controllerMock.isSaveOrRecoveryLocked = false;
    controllerMock.isFormDisabled = true;
    controllerMock.isEditingDocument = false;
    controllerMock.editSection = "details";
    controllerMock.activeDocumentSection = null;
    controllerMock.descriptionAssetUploads = [
      { id: "upload-1", fileName: "draft.png", status: "uploading" },
    ];
    const formSpy = spyOn(taskDetailsFormModule, "TaskDetailsForm").mockImplementation(() =>
      createElement("div", { "data-testid": "task-details-form" }),
    );
    testSpies.push(formSpy);

    try {
      const rendered = render(
        createElement(TaskCreateModal, {
          open: true,
          onOpenChange: () => {},
          tasks: [],
          task: null,
        }),
      );
      try {
        const form = await screen.findByTestId("task-details-form");
        expect(form.closest("fieldset")?.disabled).toBe(true);
        expect(formSpy.mock.calls[0]?.[0].disabled).toBe(false);
      } finally {
        await act(async () => rendered.unmount());
      }
    } finally {
      controllerMock.isFormDisabled = false;
      controllerMock.isEditingDocument = true;
      controllerMock.editSection = { artifactCode: "spec" };
      controllerMock.activeDocumentSection = "spec";
      controllerMock.descriptionAssetUploads = [];
    }
  });

  test("locks mutation controls but keeps Close available after partial state", async () => {
    controllerMock.isRecoveryBlocked = true;
    controllerMock.isSaveOrRecoveryLocked = true;
    controllerMock.isFormDisabled = true;
    controllerMock.isEditingDocument = false;
    controllerMock.editSection = "details";
    controllerMock.activeDocumentSection = null;
    controllerMock.footerError =
      "Refresh before continuing. Task: created-task · Phase: compensate_create · Durable state: created_partial";
    const formSpy = spyOn(taskDetailsFormModule, "TaskDetailsForm").mockImplementation(() =>
      createElement("div", { "data-testid": "task-details-form" }),
    );
    testSpies.push(formSpy);
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
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }).disabled).toBe(
        true,
      );
      expect(await screen.findByTestId("task-details-form")).toBeTruthy();
      expect(formSpy.mock.calls[0]?.[0].disabled).toBe(true);
      await act(async () => rendered.unmount());
    } finally {
      controllerMock.isRecoveryBlocked = false;
      controllerMock.isSaveOrRecoveryLocked = false;
      controllerMock.isFormDisabled = false;
      controllerMock.isEditingDocument = true;
      controllerMock.editSection = { artifactCode: "spec" };
      controllerMock.activeDocumentSection = "spec";
      controllerMock.footerError = null;
    }
  });
});
