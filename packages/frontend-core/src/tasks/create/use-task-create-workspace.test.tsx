import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import { act, waitFor } from "@testing-library/react";
import { taskQueryKeys } from "../../queries/tasks";
import { workflowQueryKeys } from "../../queries/workflows";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import {
  openWorkspaces,
  otherWorkspace,
  renderController,
} from "./use-task-create-modal-controller.test-harness";

describe("New task workspace", () => {
  test("creates a new task in its destination while another workspace is active", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask, destination: otherWorkspace });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBeNull();

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).toHaveBeenCalledWith(
        { workspaceId: "workspace-2", workspaceName: "Other workspace", repoPath: "/other-repo" },
        expect.objectContaining({ title: "Draft" }),
        undefined,
      );
    } finally {
      harness.unmount();
    }
  });

  test("creates a new task in a picked workspace and keeps the typed fields", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask });
    try {
      expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-1");
      expect(harness.getController().workspacePicker?.choices).toEqual(openWorkspaces);
      act(() => harness.getController().selectCreateIssueType("bug"));
      act(() => harness.getController().updateState({ title: "Draft", description: "Body" }));

      act(() => harness.getController().workspacePicker!.select("workspace-2"));

      // The workflow of the next workspace offers Bug too, so the form keeps the details step.
      expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
      expect(harness.getController().step).toBe("details");
      expect(harness.getController().selectedCreateIssueType).toBe("bug");
      expect(harness.getController().state).toMatchObject({ title: "Draft", description: "Body" });

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).toHaveBeenCalledWith(
        { workspaceId: "workspace-2", workspaceName: "Other workspace", repoPath: "/other-repo" },
        expect.objectContaining({ title: "Draft", description: "Body", issueType: "bug" }),
        undefined,
      );
    } finally {
      harness.unmount();
    }
  });

  test("asks for the issue type again when the next workflow is not loaded", () => {
    const harness = renderController();
    try {
      act(() => harness.getController().selectCreateIssueType("bug"));
      act(() => harness.getController().updateState({ title: "Draft" }));
      harness.connection.queryClient.removeQueries({
        queryKey: workflowQueryKeys.workspace(otherWorkspace),
      });

      act(() => harness.getController().workspacePicker!.select("workspace-2"));

      expect(harness.getController().step).toBe("type");
      expect(harness.getController().selectedCreateIssueType).toBeNull();
      expect(harness.getController().state.title).toBe("Draft");
    } finally {
      harness.unmount();
    }
  });

  test("keeps the typed fields when the picked workspace closes and creates in a replacement", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask });
    try {
      act(() => harness.getController().workspacePicker!.select("workspace-2"));
      act(() => harness.getController().updateState({ title: "Draft", description: "Body" }));

      act(() => harness.setOpenWorkspaces([openWorkspaces[0]!]));

      expect(harness.getController().footerError).toBe(
        "Other workspace is closed. Reopen it or pick another workspace to create this task.",
      );
      expect(harness.getController().state).toMatchObject({ title: "Draft", description: "Body" });

      act(() => harness.getController().workspacePicker!.select("workspace-1"));
      act(() => harness.getController().selectCreateIssueType("task"));
      expect(harness.getController().state).toMatchObject({ title: "Draft", description: "Body" });
      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).toHaveBeenCalledWith(
        { workspaceId: "workspace-1", workspaceName: "Workspace", repoPath: "/repo" },
        expect.objectContaining({ title: "Draft", description: "Body" }),
        undefined,
      );
    } finally {
      harness.unmount();
    }
  });

  test("leaves the retained draft of a picked workspace alone", () => {
    const retained = renderController({ destination: otherWorkspace });
    act(() => retained.getController().updateState({ title: "Draft in B" }));
    retained.unmount();

    const blank = renderController({ connection: retained.connection });
    act(() => blank.getController().workspacePicker!.select("workspace-2"));
    blank.unmount();

    const reopened = renderController({
      connection: retained.connection,
      destination: otherWorkspace,
    });
    try {
      expect(reopened.getController().state.title).toBe("Draft in B");
    } finally {
      reopened.unmount();
    }
  });

  test("reopens an unsaved draft in the workspace that the user picked", () => {
    const first = renderController();
    act(() => first.getController().workspacePicker!.select("workspace-2"));
    act(() => first.getController().updateState({ title: "Draft" }));
    first.unmount();

    const reopened = renderController({ connection: first.connection });
    try {
      expect(reopened.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
      expect(reopened.getController().state.title).toBe("Draft");
    } finally {
      reopened.unmount();
    }
  });

  test("starts the next opening in the current workspace after Close", async () => {
    const harness = renderController();
    try {
      act(() => harness.getController().workspacePicker!.select("workspace-2"));
      await act(async () => {
        await harness.getController().close();
      });
      act(() => harness.setOpen(false));
      act(() => harness.setOpen(true));

      expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-1");
    } finally {
      harness.unmount();
    }

    const next = renderController({ connection: harness.connection });
    try {
      expect(next.getController().workspacePicker?.target?.workspaceId).toBe("workspace-1");
    } finally {
      next.unmount();
    }
  });

  test("suggests the labels of the chosen workspace", () => {
    const connection = createTestClientConnection();
    for (const [workspace, label] of [
      [openWorkspaces[0]!, "ui"],
      [otherWorkspace, "api"],
    ] as const)
      connection.queryClient.setQueryData(taskQueryKeys.repoData(workspace), {
        tasks: [createTaskCardFixture({ id: `${workspace.workspaceId}-task`, labels: [label] })],
      });
    const harness = renderController({ connection });
    try {
      expect(harness.getController().knownLabels).toEqual(["ui"]);

      act(() => harness.getController().workspacePicker!.select("workspace-2"));

      expect(harness.getController().knownLabels).toEqual(["api"]);
    } finally {
      harness.unmount();
    }
  });

  test("tells why the labels of the chosen workspace are not available", async () => {
    const connection = createTestClientConnection({
      client: {
        tasksList: async () => {
          throw new Error("The host is offline.");
        },
      },
    });
    const harness = renderController({ connection });
    try {
      await waitFor(() =>
        expect(harness.getController().labelsError).toBe(
          "Label suggestions are not available: The host is offline.",
        ),
      );
      expect(harness.getController().knownLabels).toEqual([]);
    } finally {
      harness.unmount();
    }
  });

  test("blocks a new task while its workspace is closed", async () => {
    const createTask = mock(async () => {});
    const harness = renderController({ createTask, workspaces: [openWorkspaces[1]!] });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBe(
        "Workspace is closed. Reopen it or pick another workspace to create this task.",
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

  describe("description images staged in a picked workspace", () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const imageMarkdown = `![diagram](odt-asset:${assetId})`;
    const stageOptions = () => ({
      client: {
        taskAssetStage: mock(async () => ({
          assetId,
          scope: "description" as const,
          originalName: "diagram.png",
          verifiedMediaType: "image/png" as const,
          byteSize: 3,
        })),
      },
      collectAssetIds: (markdown: string) => new Set(markdown.includes(assetId) ? [assetId] : []),
    });
    const stageImageInOtherWorkspace = async (
      harness: ReturnType<typeof renderController>,
    ): Promise<void> => {
      act(() => harness.getController().workspacePicker!.select("workspace-2"));
      act(() => harness.getController().selectCreateIssueType("task"));
      await act(async () => {
        await harness
          .getController()
          .stageDescriptionImage({ name: "diagram.png", type: "image/png", size: 3 });
      });
      act(() =>
        harness.getController().updateState({ title: "Draft", description: imageMarkdown }),
      );
    };

    test("never sends the images to another workspace after their workspace closes", async () => {
      const createTask = mock(async () => {});
      const harness = renderController({ createTask, ...stageOptions() });
      try {
        await stageImageInOtherWorkspace(harness);

        act(() => harness.setOpenWorkspaces([openWorkspaces[0]!]));
        act(() => harness.getController().workspacePicker!.select("workspace-1"));
        await act(async () => {
          await harness.getController().submit();
        });

        expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
        expect(harness.getController().workspacePicker?.blockedReason).not.toBeNull();
        expect(harness.getController().footerError).toBe(
          "Other workspace is closed. Reopen it, or remove the description images to pick another workspace.",
        );
        expect(createTask).not.toHaveBeenCalled();
        expect(harness.getController().state.description).toBe(imageMarkdown);
      } finally {
        harness.unmount();
      }
    });

    test("removes the images and creates the rest of the draft in another workspace", async () => {
      const createTask = mock(async () => {});
      const harness = renderController({ createTask, ...stageOptions() });
      try {
        await stageImageInOtherWorkspace(harness);
        act(() =>
          harness.getController().updateState({ description: `Intro\n${imageMarkdown}\nEnd` }),
        );
        act(() => harness.setOpenWorkspaces([openWorkspaces[0]!]));

        act(() => harness.getController().workspacePicker!.removeImages());
        expect(harness.getController().state).toMatchObject({
          title: "Draft",
          description: "Intro\nEnd",
        });
        expect(harness.getController().workspacePicker?.blockedReason).toBeNull();

        act(() => harness.getController().workspacePicker!.select("workspace-1"));
        act(() => harness.getController().selectCreateIssueType("task"));
        await act(async () => {
          await harness.getController().submit();
        });

        expect(createTask).toHaveBeenCalledWith(
          { workspaceId: "workspace-1", workspaceName: "Workspace", repoPath: "/repo" },
          expect.objectContaining({ title: "Draft", description: "Intro\nEnd" }),
          undefined,
        );
      } finally {
        harness.unmount();
      }
    });

    test("frees the workspace once the description no longer uses the images", async () => {
      const harness = renderController(stageOptions());
      try {
        await stageImageInOtherWorkspace(harness);
        act(() => harness.getController().workspacePicker!.select("workspace-1"));
        expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");

        act(() => harness.getController().updateState({ description: "Plain text" }));
        act(() => harness.getController().workspacePicker!.select("workspace-1"));

        expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-1");
        expect(harness.getController().state.description).toBe("Plain text");
      } finally {
        harness.unmount();
      }
    });

    test("frees a reopened draft once its description no longer uses the images", async () => {
      const first = renderController(stageOptions());
      await stageImageInOtherWorkspace(first);
      first.unmount();

      const reopened = renderController({ connection: first.connection, ...stageOptions() });
      try {
        expect(reopened.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
        act(() => reopened.getController().updateState({ description: "Plain text" }));
        act(() => reopened.getController().workspacePicker!.select("workspace-1"));

        expect(reopened.getController().workspacePicker?.target?.workspaceId).toBe("workspace-1");
        expect(reopened.getController().state).toMatchObject({
          title: "Draft",
          description: "Plain text",
        });
      } finally {
        reopened.unmount();
      }
    });

    test("keeps the workspace and the refresh message after a partial create", async () => {
      const createTask = mock(async () => {
        throw new HostInvokeError("Task creation failed", {
          kind: "task_asset",
          taskAssetFailure: {
            operation: "create",
            code: "partial_state",
            taskId: "created-task",
            assetIds: [assetId],
            failedPhase: "compensate_create",
            durableState: "created_partial",
            retryAllowed: false,
            message: "Refresh before continuing.",
          },
        });
      });
      const harness = renderController({ createTask, ...stageOptions() });
      try {
        await stageImageInOtherWorkspace(harness);
        await act(async () => {
          await harness.getController().submit();
        });
        const recoveryError = harness.getController().footerError;
        expect(recoveryError).toContain("created-task");
        expect(harness.getController().workspacePicker?.isLocked).toBe(true);

        act(() => harness.getController().workspacePicker!.removeImages());
        act(() => harness.getController().workspacePicker!.select("workspace-1"));

        expect(harness.getController().state.description).toBe(imageMarkdown);
        expect(harness.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
        expect(harness.getController().footerError).toBe(recoveryError);

        // A closed workspace does not replace the refresh steps while recovery locks the form.
        act(() => harness.setOpenWorkspaces([openWorkspaces[0]!]));
        expect(harness.getController().workspacePicker?.isLocked).toBe(true);
        expect(harness.getController().footerError).toBe(recoveryError);
        expect(harness.getController().workspacePicker?.blockedReason).toBeNull();
      } finally {
        harness.unmount();
      }
    });

    test("reopens a retained draft in the workspace of its images", async () => {
      const first = renderController(stageOptions());
      await stageImageInOtherWorkspace(first);
      first.unmount();

      const createTask = mock(async () => {});
      const reopened = renderController({
        createTask,
        connection: first.connection,
        ...stageOptions(),
      });
      try {
        expect(reopened.getController().workspacePicker?.target?.workspaceId).toBe("workspace-2");
        expect(reopened.getController().state.description).toBe(imageMarkdown);
        act(() => reopened.getController().selectCreateIssueType("task"));
        await act(async () => {
          await reopened.getController().submit();
        });

        expect(createTask).toHaveBeenCalledWith(
          { workspaceId: "workspace-2", workspaceName: "Other workspace", repoPath: "/other-repo" },
          expect.objectContaining({ description: imageMarkdown }),
          { stagedAssetIds: [assetId] },
        );
      } finally {
        reopened.unmount();
      }
    });
  });
});
