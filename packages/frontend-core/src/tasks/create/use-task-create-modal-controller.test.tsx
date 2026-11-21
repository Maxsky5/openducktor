import { workspaceWorkflows, type WorkspaceWorkflows } from "../../queries/workflows";
import {
  builtinWorkflowCatalogFixture,
  builtinWorkflowDescriptor,
  builtinWorkspaceWorkflowFixture,
} from "../../test-support/workflow-fixtures";
import {
  compileWorkflowCatalog,
  specPlanBuildWorkflow,
  taskWorkflowDescriptor,
} from "@openducktor/workflows";
import { createReviewTaskWorkflow, reviewTaskRoles } from "@openducktor/workflows/test-support";
import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { TaskCreateInput } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { act } from "@testing-library/react";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { TaskCreateWorkspace, TasksStateContextValue } from "../../types/state-slices";
import {
  createDocumentState,
  renderController,
  specSavedAt,
} from "./use-task-create-modal-controller.test-harness";

/** A repository that enables the built-in workflow, its default, and a custom review workflow. */
const twoWorkflowWorkspace = (): WorkspaceWorkflows => {
  const review = createReviewTaskWorkflow();
  const catalog = compileWorkflowCatalog({
    ...structuredClone(builtinWorkflowCatalogFixture),
    roles: [...structuredClone(builtinWorkflowCatalogFixture.roles), ...reviewTaskRoles],
    workflows: [structuredClone(builtinWorkflowDescriptor), taskWorkflowDescriptor(review)],
  });
  return workspaceWorkflows(catalog, {
    ...structuredClone(builtinWorkspaceWorkflowFixture),
    workflows: [specPlanBuildWorkflow.reference, review.reference],
    newTaskWorkflows: [specPlanBuildWorkflow.reference, review.reference],
  });
};

describe("useTaskCreateModalController workflow choice", () => {
  test("offers the types of every workflow, then the workflows that take the picked type", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({
      createTask,
      offerWorkflowChoice: true,
      workspace: twoWorkflowWorkspace(),
    });
    try {
      const choices = harness.getController().workflowChoices.map(({ reference }) => reference.id);
      expect(choices).toEqual([specPlanBuildWorkflow.reference.id, "review"]);
      expect(harness.getController().typeStepChoices.map(({ value }) => value)).toEqual([
        "feature",
        "bug",
        "task",
      ]);
      expect(harness.getController().workflowsForType).toEqual([]);
      // Both workflows take a bug, so the form opens the workflow step with the default picked.
      act(() => harness.getController().selectCreateIssueType("bug"));
      expect(harness.getController().step).toBe("workflow");
      expect(harness.getController().stepBefore).toBe("type");
      expect(harness.getController().workflowsForType.map(({ reference }) => reference.id)).toEqual(
        [specPlanBuildWorkflow.reference.id, "review"],
      );
      expect(harness.getController().taskWorkflow?.reference.id).toBe(
        specPlanBuildWorkflow.reference.id,
      );
      act(() => harness.getController().selectWorkflow("review"));
      expect(harness.getController().step).toBe("workflow");
      expect(harness.getController().stepAfter).toBe("details");
      act(() => harness.getController().setStep("details"));
      const controller = harness.getController();
      expect(controller.step).toBe("details");
      expect(controller.stepBefore).toBe("workflow");
      expect(controller.taskWorkflow?.reference.id).toBe("review");
      expect(controller.state.issueType).toBe("bug");
      act(() => harness.getController().updateState({ title: "Draft" }));
      await act(async () => {
        await harness.getController().submit();
      });
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1" }),
        expect.objectContaining({ title: "Draft", issueType: "bug", workflowId: "review" }),
        undefined,
      );
    } finally {
      harness.unmount();
    }
  });

  test("a type that one workflow takes picks that workflow and goes on to the details", () => {
    const harness = renderController({
      offerWorkflowChoice: true,
      workspace: twoWorkflowWorkspace(),
      initialWorkflowId: "review",
    });
    try {
      // Both workflows take a bug, so the steps before a pick name the workflow step.
      expect(harness.getController().steps).toEqual(["type", "workflow", "details"]);
      // The review workflow has no "task" type.
      act(() => harness.getController().selectCreateIssueType("task"));
      expect(harness.getController().step).toBe("details");
      // The stepper and Back skip the workflow step, since one workflow takes the type.
      expect(harness.getController().steps).toEqual(["type", "details"]);
      expect(harness.getController().stepBefore).toBe("type");
      expect(harness.getController().taskWorkflow?.reference.id).toBe(
        specPlanBuildWorkflow.reference.id,
      );
    } finally {
      harness.unmount();
    }
  });

  test("asks for another workflow when the picked one is no longer enabled, and creates nothing", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({
      createTask,
      offerWorkflowChoice: true,
      workspace: twoWorkflowWorkspace(),
      initialWorkflowId: "retired",
    });
    try {
      const controller = harness.getController();
      expect(controller.workflowRead.selectionError).toContain('Workflow "retired"');
      expect(controller.footerError).toContain("Pick another workflow");
      // The form stays open, so the type and workflow steps still work.
      expect(controller.isFormDisabled).toBe(false);
      act(() => harness.getController().updateState({ title: "Draft" }));
      await act(async () => {
        await harness.getController().submit();
      });
      expect(createTask).not.toHaveBeenCalled();
      act(() => harness.getController().selectCreateIssueType("task"));
      expect(harness.getController().workflowRead.selectionError).toBeNull();
      expect(harness.getController().taskWorkflow?.reference.id).toBe(
        specPlanBuildWorkflow.reference.id,
      );
    } finally {
      harness.unmount();
    }
  });

  test("keeps the workflow that the opener names while it takes the picked type", () => {
    const harness = renderController({
      offerWorkflowChoice: true,
      workspace: twoWorkflowWorkspace(),
      initialWorkflowId: "review",
    });
    try {
      expect(harness.getController().taskWorkflow?.reference.id).toBe("review");
      act(() => harness.getController().selectCreateIssueType("bug"));
      expect(harness.getController().step).toBe("workflow");
      expect(harness.getController().taskWorkflow?.reference.id).toBe("review");
    } finally {
      harness.unmount();
    }
  });

  test("shows no choice for one enabled workflow and still names it in the create input", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask, offerWorkflowChoice: true });
    try {
      expect(harness.getController().workflowChoices).toEqual([]);
      act(() => harness.getController().updateState({ title: "Draft" }));
      await act(async () => {
        await harness.getController().submit();
      });
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1" }),
        expect.objectContaining({ workflowId: specPlanBuildWorkflow.reference.id }),
        undefined,
      );
    } finally {
      harness.unmount();
    }
  });

  test("leaves the workflow to the host when the form offers no choice", async () => {
    const createTask = mock(async (_workspace: TaskCreateWorkspace, _input: TaskCreateInput) => {});
    const harness = renderController({ createTask, workspace: twoWorkflowWorkspace() });
    try {
      expect(harness.getController().workflowChoices).toEqual([]);
      expect(harness.getController().taskWorkflow?.reference.id).toBe(
        specPlanBuildWorkflow.reference.id,
      );
      act(() => harness.getController().updateState({ title: "Draft" }));
      await act(async () => {
        await harness.getController().submit();
      });
      expect(createTask.mock.calls[0]?.[1]).not.toHaveProperty("workflowId");
    } finally {
      harness.unmount();
    }
  });
});

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

  test("keeps edited fields and submits only those fields after a saved task change", async () => {
    const updateCalls: Array<{ taskId: string; patch: unknown }> = [];
    const original = createTaskCardFixture({
      id: "task-1",
      title: "Original",
      description: "Original description",
    });
    const replacement = createTaskCardFixture(original, {
      description: "Changed elsewhere",
      title: "New saved title",
      updatedAt: "2026-07-25T11:00:00.000Z",
    });
    const harness = renderController({
      task: original,
      updateTask: async (taskId, patch) => {
        updateCalls.push({ taskId, patch });
      },
    });

    act(() => {
      harness.getController().updateState({ description: "Local draft" });
    });
    await act(async () => {
      harness.replaceTask(replacement);
    });

    expect(harness.getController().state.description).toBe("Local draft");
    expect(harness.getController().state.title).toBe("New saved title");
    expect(harness.getController().footerError).toBeNull();
    await act(async () => {
      await harness.getController().submit();
    });
    expect(updateCalls).toEqual([{ taskId: "task-1", patch: { description: "Local draft" } }]);
    harness.unmount();
  });

  test("restores a task draft after its editor unmounts without mixing hosts", () => {
    const task = createTaskCardFixture({ id: "task-1", title: "Saved" });
    const first = renderController({ task });
    act(() => first.getController().updateState({ title: "Unsaved" }));
    first.unmount();
    const restored = renderController({ task, connection: first.connection });
    const otherHost = renderController({ task });
    try {
      expect(restored.getController().state.title).toBe("Unsaved");
      expect(otherHost.getController().state.title).toBe("Saved");
    } finally {
      restored.unmount();
      otherHost.unmount();
    }
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

  test.each(["open", "reopened"] as const)(
    "blocks a document save when the host changes a draft in the %s editor",
    async (editor) => {
      const saveDocument = mock(async () => ({ updatedAt: "2026-07-25T12:00:00.000Z" }));
      let document = { markdown: "# Spec", updatedAt: "2026-07-25T10:00:00.000Z" };
      const documentState = createDocumentState({
        saveDocument,
        loadDocument: async () => document,
      });
      let task = createTaskCardFixture({
        id: "task-1",
        artifactSummary: specSavedAt(document.updatedAt),
      });
      let harness = renderController({ task, documentState });
      try {
        act(() => harness.getController().requestSectionChange({ artifactCode: "spec" }));
        await act(async () => {
          await Promise.resolve();
        });
        act(() => harness.getController().updateDocumentDraft("spec", "# Local spec"));
        document = { markdown: "# New host spec", updatedAt: "2026-07-25T11:00:00.000Z" };
        task = createTaskCardFixture(task, { artifactSummary: specSavedAt(document.updatedAt) });
        if (editor === "reopened") {
          harness.unmount();
          harness = renderController({ task, documentState, connection: harness.connection });
          act(() => harness.getController().requestSectionChange({ artifactCode: "spec" }));
        } else {
          harness.replaceTask(task);
        }
        await act(async () => {
          await Promise.resolve();
        });
        await act(async () => {
          await harness.getController().saveActiveDocument();
        });

        expect(saveDocument).not.toHaveBeenCalled();
        expect(harness.getController().activeDraft).toBe("# Local spec");
        expect(harness.getController().footerError).toBe(
          "This document changed on the host while you were editing. Your edits are kept. Copy what you need, then close and reopen the task to load the latest version.",
        );
        expect(harness.getController().isSavingDocument).toBeNull();
      } finally {
        harness.unmount();
      }
    },
  );

  test("saves a document again while the task card still shows the version before its save", async () => {
    const saveDocument = mock(async () => ({ updatedAt: "2026-07-25T12:00:00.000Z" }));
    const harness = renderController({
      task: createTaskCardFixture({
        id: "task-1",
        artifactSummary: specSavedAt("2026-07-25T10:00:00.000Z"),
      }),
      documentState: createDocumentState({ saveDocument }),
    });
    try {
      act(() => harness.getController().requestSectionChange({ artifactCode: "spec" }));
      await act(async () => {
        await Promise.resolve();
      });
      for (const draft of ["# First", "# Second"]) {
        act(() => harness.getController().updateDocumentDraft("spec", draft));
        await act(async () => {
          await harness.getController().saveActiveDocument();
        });
      }

      expect(saveDocument).toHaveBeenCalledTimes(2);
      expect(harness.getController().footerError).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  test.each(["save", "discard", "connection disposal"] as const)(
    "retains a staged description image through unmount until %s",
    async (finish) => {
      const assetId = "550e8400-e29b-41d4-a716-446655440000";
      const bytes = new Set<string>();
      const releasePreview = mock((_url: string) => {});
      const taskAssetStage = mock(async () => {
        bytes.add(assetId);
        return {
          assetId,
          scope: "description" as const,
          originalName: "diagram.png",
          verifiedMediaType: "image/png" as const,
          byteSize: 3,
        };
      });
      const taskAssetDiscardStaged = mock(
        async ({ assetIds }: Parameters<HostClient["taskAssetDiscardStaged"]>[0]) => {
          for (const id of assetIds) bytes.delete(id);
        },
      );
      const connection = createTestClientConnection({
        client: { taskAssetStage, taskAssetDiscardStaged },
      });
      const task = createTaskCardFixture({ id: "task-1" });
      const readAssetIds = (markdown: string) =>
        new Set(markdown.includes(assetId) ? [assetId] : []);
      const updateTask = mock(
        async (
          _taskId: string,
          _patch: Parameters<TasksStateContextValue["updateTask"]>[1],
          assets?: Parameters<TasksStateContextValue["updateTask"]>[2],
        ) => {
          if (!bytes.has(assetId) || !assets?.stagedAssetIds.includes(assetId))
            throw new Error("The staged image is missing.");
        },
      );
      const original = renderController({
        task,
        connection,
        collectAssetIds: readAssetIds,
        revokePreviewUrl: releasePreview,
      });
      await act(async () => {
        await original
          .getController()
          .stageDescriptionImage({ name: "diagram.png", type: "image/png", size: 3 });
      });
      act(() =>
        original.getController().updateState({ description: `![Diagram](odt-asset://${assetId})` }),
      );
      original.unmount();
      expect(bytes.has(assetId)).toBe(true);
      expect(taskAssetDiscardStaged).not.toHaveBeenCalled();
      expect(releasePreview).not.toHaveBeenCalled();
      const restored = renderController({
        task,
        connection,
        updateTask,
        collectAssetIds: readAssetIds,
        revokePreviewUrl: releasePreview,
      });
      let restoredMounted = true;
      try {
        expect(restored.getController().state.description).toContain(assetId);
        expect(restored.getController().descriptionAssetPreviews.get(assetId)).toBe(
          "preview:diagram.png",
        );
        await act(async () => {
          if (finish === "save") await restored.getController().submit();
          else if (finish === "discard") await restored.getController().close();
          else {
            restored.unmount();
            restoredMounted = false;
            await connection.dispose();
          }
        });
        if (finish === "save") {
          expect(updateTask).toHaveBeenCalledWith(
            task.id,
            expect.objectContaining({ description: expect.stringContaining(assetId) }),
            { stagedAssetIds: [assetId] },
          );
          expect(restored.getController().footerError).toBeNull();
          expect(bytes.has(assetId)).toBe(true);
        } else {
          expect(bytes.has(assetId)).toBe(false);
          expect(updateTask).not.toHaveBeenCalled();
        }
      } finally {
        if (restoredMounted) restored.unmount();
      }
      expect(taskAssetDiscardStaged).toHaveBeenCalledTimes(finish === "save" ? 0 : 1);
      expect(releasePreview).toHaveBeenCalledWith("preview:diagram.png");
      expect(releasePreview).toHaveBeenCalledTimes(1);
    },
  );

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
      act(() => harness.getController().requestSectionChange({ artifactCode: "spec" }));
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
