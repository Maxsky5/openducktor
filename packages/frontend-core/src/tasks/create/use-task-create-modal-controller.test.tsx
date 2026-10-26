import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { act, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  ActiveWorkspaceContext,
  SpecStateContext,
  TasksStateContext,
} from "../../app-state/app-state-contexts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { ActiveWorkspace } from "../../types/session-slices";
import type { SpecStateContextValue, TasksStateContextValue } from "../../types/state-slices";
import {
  type TaskCreateDestination,
  useTaskCreateModalController,
} from "./use-task-create-modal-controller";

type TestImage = { name: string; type: string; size: number };

const activeWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
};

const createSpecState = (
  overrides: Partial<SpecStateContextValue> = {},
): SpecStateContextValue => ({
  loadSpec: async () => "",
  loadSpecDocument: async () => ({ markdown: "# Spec", updatedAt: "2026-07-25T10:00:00.000Z" }),
  loadPlanDocument: async () => ({ markdown: "", updatedAt: null }),
  loadQaReportDocument: async () => ({ markdown: "", updatedAt: null }),
  saveSpec: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  saveSpecArtifact: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  savePlanArtifact: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  ...overrides,
});

const createTasksState = (
  updateTask: TasksStateContextValue["updateTask"],
  createTask: TasksStateContextValue["createTask"] = async () => {},
): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks: [],
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  createTask,
  updateTask,
  setTaskTargetBranch: async () => {},
  deleteTask: async () => {},
  closeTask: async () => {},
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  transitionTask: async () => {},
  humanApproveTask: async () => {},
  humanRequestChangesTask: async () => {},
});

const readFileBase64 = async (_file: TestImage): Promise<string> => "AQID";
const createPreviewUrl = (file: TestImage): string => `preview:${file.name}`;
const revokePreviewUrl = (_url: string): void => {};
const collectAssetIds = (_markdown: string): Set<string> => new Set();

const specSavedAt = (updatedAt: string): TaskCard["artifactSummary"] => ({
  spec: { has: true, updatedAt },
  plan: { has: false },
  qaReport: { has: false, verdict: "not_reviewed" },
});

type Controller = ReturnType<typeof useTaskCreateModalController<TestImage>>;

type RenderOptions = {
  task?: TaskCard | null;
  updateTask?: TasksStateContextValue["updateTask"];
  createTask?: TasksStateContextValue["createTask"];
  destination?: TaskCreateDestination | null;
  initialTitle?: string;
  specState?: SpecStateContextValue;
  client?: Partial<HostClient>;
};

const renderController = ({
  task = null,
  updateTask = async () => {},
  createTask = async () => {},
  destination = null,
  initialTitle = "",
  specState = createSpecState(),
  client = {},
}: RenderOptions = {}) => {
  let latest: Controller | null = null;
  const feedback = createFeedbackFake();
  const connection = createTestClientConnection({ feedback, client });

  const Probe = ({ current }: { current: TaskCard | null }): null => {
    latest = useTaskCreateModalController({
      open: true,
      onOpenChange: () => {},
      tasks: current ? [current] : [],
      task: current,
      destination,
      initialTitle,
      readFileBase64,
      createPreviewUrl,
      revokePreviewUrl,
      collectAssetIds,
    });
    return null;
  };

  const providers = (children: ReactNode): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <ActiveWorkspaceContext.Provider value={{ activeWorkspace, setActiveWorkspace: () => {} }}>
        <TasksStateContext.Provider value={createTasksState(updateTask, createTask)}>
          <SpecStateContext.Provider value={specState}>{children}</SpecStateContext.Provider>
        </TasksStateContext.Provider>
      </ActiveWorkspaceContext.Provider>
    </ClientConnectionProvider>
  );

  const view = render(providers(<Probe current={task} />));
  return {
    feedback,
    getController: (): Controller => {
      if (!latest) {
        throw new Error("Controller did not render.");
      }
      return latest;
    },
    replaceTask: (next: TaskCard): void => {
      view.rerender(providers(<Probe current={next} />));
    },
    unmount: view.unmount,
  };
};

describe("useTaskCreateModalController", () => {
  test.each(["create", "edit"])(
    "locks a held %s request and restores the draft after failure",
    async (mode) => {
      let rejectRequest: ((reason: Error) => void) | undefined;
      const pendingRequest = new Promise<void>((_resolve, reject) => {
        rejectRequest = reject;
      });
      const createTask = mock(async () => pendingRequest);
      const updateTask = mock(async () => pendingRequest);
      const task = mode === "edit" ? createTaskCardFixture({ id: "task-1" }) : null;
      const harness = renderController({ task, updateTask, createTask });
      try {
        act(() =>
          harness.getController().updateState({ title: "Draft", description: "Draft body" }),
        );
        let submission: Promise<void> | undefined;
        act(() => {
          submission = harness.getController().submit();
        });
        expect(harness.getController().isFormDisabled).toBe(true);
        expect(mode === "create" ? createTask : updateTask).toHaveBeenCalledTimes(1);

        await act(async () => {
          rejectRequest?.(new Error("Save failed"));
          await submission;
        });
        expect(harness.getController().isFormDisabled).toBe(false);
        expect(harness.getController().state.description).toBe("Draft body");
        expect(harness.getController().footerError).toBe("Save failed");
      } finally {
        harness.unmount();
      }
    },
  );

  test("creates one task for a double tap that comes before the busy state renders", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));

      await act(async () => {
        const controller = harness.getController();
        await Promise.all([controller.submit(), controller.submit()]);
      });

      expect(createTask).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  test("creates a new task only in the workspace that was active when it opened", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({
      createTask,
      destination: { workspaceId: "workspace-2", workspaceName: "Other workspace" },
    });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBe(
        "This task is for Other workspace. Open Other workspace again to create it.",
      );

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).not.toHaveBeenCalled();
      expect(harness.getController().state.title).toBe("Draft");
    } finally {
      harness.unmount();
    }
  });

  test("creates a new task when its workspace is active", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({
      createTask,
      destination: { workspaceId: "workspace-1", workspaceName: "Workspace" },
    });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBeNull();

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  test("starts a new task with the requested title", () => {
    const harness = renderController({ initialTitle: "Write docs" });
    try {
      expect(harness.getController().state.title).toBe("Write docs");
      expect(harness.getController().step).toBe("type");
    } finally {
      harness.unmount();
    }
  });

  test("counts a type or label choice of a new task as an edit", () => {
    const harness = renderController({ initialTitle: "Write docs" });
    try {
      expect(harness.getController().isTaskDraftDirty).toBe(false);

      act(() => harness.getController().selectCreateIssueType("bug"));
      expect(harness.getController().isTaskDraftDirty).toBe(true);
    } finally {
      harness.unmount();
    }

    const labels = renderController();
    try {
      act(() => labels.getController().updateState({ labels: ["mobile"] }));
      expect(labels.getController().isTaskDraftDirty).toBe(true);
    } finally {
      labels.unmount();
    }
  });

  test("counts an edit only while the draft differs from the saved task", () => {
    const task = createTaskCardFixture({ id: "task-1", priority: 2, labels: ["api"] });
    const harness = renderController({ task });
    try {
      expect(harness.getController().isTaskDraftDirty).toBe(false);

      act(() => harness.getController().updateState({ priority: 1 }));
      expect(harness.getController().isTaskDraftDirty).toBe(true);

      act(() => harness.getController().updateState({ priority: 2 }));
      expect(harness.getController().isTaskDraftDirty).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  test("rehydrates an untouched draft when the open task changes with the same ID", async () => {
    const original = createTaskCardFixture({
      id: "task-1",
      title: "Original",
      description: "Original description",
    });
    const replacement = createTaskCardFixture(original, {
      title: "Updated",
      description: "Updated description",
      updatedAt: "2026-07-25T11:00:00.000Z",
    });
    const harness = renderController({ task: original });

    await act(async () => {
      harness.replaceTask(replacement);
    });

    expect(harness.getController().state.title).toBe("Updated");
    expect(harness.getController().state.description).toBe("Updated description");
    expect(harness.getController().footerError).toBeNull();
    harness.unmount();
  });

  test("keeps a dirty draft and blocks saving after a same-task external change", async () => {
    const updateCalls: string[] = [];
    const original = createTaskCardFixture({
      id: "task-1",
      title: "Original",
      description: "Original description",
    });
    const replacement = createTaskCardFixture(original, {
      description: "Changed elsewhere",
      updatedAt: "2026-07-25T11:00:00.000Z",
    });
    const harness = renderController({
      task: original,
      updateTask: async (taskId) => {
        updateCalls.push(taskId);
      },
    });

    act(() => {
      harness.getController().updateState({ description: "Local draft" });
    });
    await act(async () => {
      harness.replaceTask(replacement);
    });

    expect(harness.getController().state.description).toBe("Local draft");
    expect(harness.getController().footerError).toBe(
      "This task changed while you were editing. Close and reopen it to load the latest version before saving.",
    );
    await act(async () => {
      await harness.getController().submit();
    });
    expect(updateCalls).toEqual([]);
    harness.unmount();
  });

  test("marks a lost save result and keeps the edits", async () => {
    const updateTask = mock(async () => {
      throw new RemoteConnectionError({
        code: "outcome_unknown",
        message: "The result of task_update was lost.",
        nextAction: "Read current host state to check the outcome.",
      });
    });
    const harness = renderController({ task: createTaskCardFixture({ id: "task-1" }), updateTask });
    try {
      act(() => harness.getController().updateState({ title: "Local title" }));
      await act(async () => {
        await harness.getController().submit();
      });
      expect(harness.getController().state.title).toBe("Local title");
      expect(harness.getController().footerErrorOutcomeUnknown).toBe(true);
      expect(harness.getController().footerError).toBe(
        "The result of task_update was lost. Read current host state to check the outcome.",
      );
    } finally {
      harness.unmount();
    }
  });

  test("blocks a document save when the live task reports a newer document", async () => {
    const saveSpecArtifact = mock(async () => ({ updatedAt: "2026-07-25T12:00:00.000Z" }));
    const task = createTaskCardFixture({
      id: "task-1",
      artifactSummary: specSavedAt("2026-07-25T10:00:00.000Z"),
    });
    const harness = renderController({ task, specState: createSpecState({ saveSpecArtifact }) });
    try {
      act(() => harness.getController().requestSectionChange("spec"));
      await act(async () => {
        await Promise.resolve();
      });
      act(() => harness.getController().updateDocumentDraft("spec", "# Local spec"));
      await act(async () => {
        harness.replaceTask(
          createTaskCardFixture(task, {
            artifactSummary: specSavedAt("2026-07-25T11:00:00.000Z"),
          }),
        );
      });
      await act(async () => {
        await harness.getController().saveActiveDocument();
      });

      expect(saveSpecArtifact).not.toHaveBeenCalled();
      expect(harness.getController().activeDraft).toBe("# Local spec");
      expect(harness.getController().footerError).toBe(
        "This document changed on the host while you were editing. Your edits are kept. Copy what you need, then close and reopen the task to load the latest version.",
      );
      expect(harness.getController().isSavingDocument).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  test("saves a document again while the task card still shows the version before its save", async () => {
    const saveSpecArtifact = mock(async () => ({ updatedAt: "2026-07-25T12:00:00.000Z" }));
    const harness = renderController({
      task: createTaskCardFixture({
        id: "task-1",
        artifactSummary: specSavedAt("2026-07-25T10:00:00.000Z"),
      }),
      specState: createSpecState({ saveSpecArtifact }),
    });
    try {
      act(() => harness.getController().requestSectionChange("spec"));
      await act(async () => {
        await Promise.resolve();
      });
      for (const draft of ["# First", "# Second"]) {
        act(() => harness.getController().updateDocumentDraft("spec", draft));
        await act(async () => {
          await harness.getController().saveActiveDocument();
        });
      }

      expect(saveSpecArtifact).toHaveBeenCalledTimes(2);
      expect(harness.getController().footerError).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  test("shows a failed image discard on a document section and clears the discard request", async () => {
    const taskAssetStage = mock(async () => ({
      assetId: "550e8400-e29b-41d4-a716-446655440000",
      scope: "description" as const,
      originalName: "diagram.png",
      verifiedMediaType: "image/png" as const,
      byteSize: 3,
    }));
    const taskAssetDiscardStaged = mock(async () => {
      throw new Error("The host is offline.");
    });
    const harness = renderController({
      task: createTaskCardFixture({ id: "task-1" }),
      client: { taskAssetStage, taskAssetDiscardStaged },
    });
    try {
      await act(async () => {
        await harness
          .getController()
          .stageDescriptionImage({ name: "diagram.png", type: "image/png", size: 3 });
      });
      act(() => harness.getController().requestSectionChange("spec"));
      await act(async () => {
        await Promise.resolve();
      });
      act(() => harness.getController().updateDocumentDraft("spec", "# Local spec"));
      await act(async () => {
        await harness.getController().close();
      });
      expect(harness.getController().pendingDiscardIntent).toEqual({ type: "close-modal" });

      await act(async () => {
        await harness.getController().confirmDiscard();
      });

      expect(taskAssetDiscardStaged).toHaveBeenCalledTimes(1);
      expect(harness.getController().pendingDiscardIntent).toBeNull();
      expect(harness.feedback.shownOf("error")).toEqual([
        {
          kind: "error",
          message: "Could not discard staged images",
          options: { description: "The host is offline." },
        },
      ]);
    } finally {
      harness.unmount();
    }
  });
});
