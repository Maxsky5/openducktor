import { afterEach, describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, useEffect, useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { FolderPickerCancelAction, FolderPickerConfirmAction } from "./folder-picker-actions";
import { InlineFolderPickerContent, useInlineFolderPickerController } from "./inline-folder-picker";
import {
  useWorkspaceCreation,
  WorkspaceCreationFields,
  WorkspaceCreationForm,
  WorkspaceCreationSubmitAction,
} from "./workspace-creation-form";

const mountedViews = new Set<ReturnType<typeof render>>();
afterEach(() => {
  for (const view of mountedViews) view.unmount();
  mountedViews.clear();
});

function SeedFilesystemDirectory(): ReactElement | null {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.setQueryData(filesystemQueryKeys.directory(), {
      currentPath: "/repo",
      currentPathIsGitRepo: true,
      parentPath: "/",
      homePath: "/repo",
      entries: [],
    });
  }, [queryClient]);
  return null;
}

function InlineWorkspaceCreationForm({
  addWorkspace,
}: {
  addWorkspace: Parameters<typeof WorkspaceCreationForm>[0]["addWorkspace"];
}): ReactElement | null {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queryClient.setQueryData(filesystemQueryKeys.directory(), {
      currentPath: "/repo",
      currentPathIsGitRepo: true,
      parentPath: "/",
      homePath: "/repo",
      entries: [],
    });
    setReady(true);
  }, [queryClient]);
  if (!ready) return null;
  return <ReadyInlineWorkspaceCreationForm addWorkspace={addWorkspace} />;
}

function ReadyInlineWorkspaceCreationForm({
  addWorkspace,
}: {
  addWorkspace: Parameters<typeof WorkspaceCreationForm>[0]["addWorkspace"];
}): ReactElement {
  const workspaceCreation = useWorkspaceCreation({
    workspaces: [],
    addWorkspace,
    initialPickerOpen: true,
  });
  const folderPicker = useInlineFolderPickerController({
    ...(workspaceCreation.repoPath ? { initialPath: workspaceCreation.repoPath } : undefined),
    requireGitRepo: true,
    onCancel: workspaceCreation.closePicker,
    onConfirm: workspaceCreation.confirmRepo,
  });
  return (
    <>
      <WorkspaceCreationFields
        controller={workspaceCreation}
        picker={
          <InlineFolderPickerContent
            controller={folderPicker}
            title="Repository browser"
            description="Choose an existing Git repository on disk."
          />
        }
      />
      <div data-testid="workspace-actions">
        <button type="button">Back to coding agents</button>
        {workspaceCreation.pickerOpen ? (
          <>
            {workspaceCreation.repoPath ? (
              <FolderPickerCancelAction controller={folderPicker} />
            ) : null}
            <FolderPickerConfirmAction
              controller={folderPicker}
              confirmLabel="Choose This Folder"
            />
          </>
        ) : (
          <WorkspaceCreationSubmitAction controller={workspaceCreation} />
        )}
      </div>
    </>
  );
}

const chooseRepository = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: /choose repository folder/i }));
  fireEvent.click(await screen.findByRole("button", { name: /choose this folder/i }));
  await screen.findByRole("button", { name: /^open repository$/i });
};

const renderForm = ({
  addWorkspace,
  onSuccess,
  duplicate = false,
}: {
  addWorkspace: Parameters<typeof WorkspaceCreationForm>[0]["addWorkspace"];
  onSuccess?: () => void;
  duplicate?: boolean;
}): void => {
  const view = render(
    <QueryProvider useIsolatedClient>
      <SeedFilesystemDirectory />
      <WorkspaceCreationForm
        workspaces={
          duplicate
            ? [
                {
                  workspaceId: "existing",
                  workspaceName: "Existing",
                  repoPath: "/repo",
                  isActive: true,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: "/worktrees",
                  effectiveWorktreeBasePath: "/worktrees",
                },
              ]
            : []
        }
        addWorkspace={addWorkspace}
        {...(onSuccess ? { onSuccess } : {})}
      />
    </QueryProvider>,
  );
  mountedViews.add(view);
};

describe("WorkspaceCreationForm", () => {
  test("renders the shared repository picker inline without opening a dialog", async () => {
    const addWorkspace = mock(async () => {});
    const view = render(
      <QueryProvider useIsolatedClient>
        <InlineWorkspaceCreationForm addWorkspace={addWorkspace} />
      </QueryProvider>,
    );
    mountedViews.add(view);

    expect(await screen.findByText("/repo")).toBeTruthy();
    expect(screen.queryByText("Choose a local Git repository to continue.")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /choose this folder/i }));
    expect(await screen.findByRole("button", { name: /^open repository$/i })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("lets the onboarding host compose its actions without duplicate helper copy", async () => {
    const addWorkspace = mock(async () => {});
    const view = render(
      <QueryProvider useIsolatedClient>
        <InlineWorkspaceCreationForm addWorkspace={addWorkspace} />
      </QueryProvider>,
    );
    mountedViews.add(view);

    const selectionActions = await screen.findByTestId("workspace-actions");
    expect(screen.queryByText("Choose a local Git repository to continue.")).toBeNull();
    expect(
      within(selectionActions).getByRole("button", { name: "Back to coding agents" }),
    ).toBeTruthy();
    fireEvent.click(within(selectionActions).getByRole("button", { name: "Choose This Folder" }));

    const submitActions = await screen.findByTestId("workspace-actions");
    expect(
      within(submitActions).getByRole("button", { name: "Back to coding agents" }),
    ).toBeTruthy();
    expect(within(submitActions).getByRole("button", { name: "Open repository" })).toBeTruthy();
  });

  test("blocks a repository that is already configured", async () => {
    const addWorkspace = mock(async () => {});
    renderForm({ addWorkspace, duplicate: true });

    await chooseRepository();

    expect(screen.getByRole("alert").textContent).toContain(
      "Repository is already configured as Existing.",
    );
    // SAFETY: This test creates the DOM fixture that supplies `HTMLButtonElement` before this lookup.
    expect(
      (screen.getByRole("button", { name: /^open repository$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(addWorkspace).not.toHaveBeenCalled();
  });

  test("derives workspace fields, stays disabled while busy, and reports success", async () => {
    const deferred = createDeferred<void>();
    const addWorkspace = mock(async () => deferred.promise);
    const onSuccess = mock(() => {});
    renderForm({ addWorkspace, onSuccess });
    await chooseRepository();

    // SAFETY: This test creates the DOM fixture that supplies `HTMLInputElement` before this lookup.
    expect((screen.getByLabelText("Workspace ID") as HTMLInputElement).value).toBe("repo");
    // SAFETY: This test creates the DOM fixture that supplies `HTMLInputElement` before this lookup.
    expect((screen.getByLabelText("Workspace name") as HTMLInputElement).value).toBe("repo");
    fireEvent.click(screen.getByRole("button", { name: /^open repository$/i }));

    const busyButton = await screen.findByRole("button", { name: "Opening repository..." });
    // SAFETY: This test creates the DOM fixture that supplies `HTMLButtonElement` before this lookup.
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    expect(addWorkspace).toHaveBeenCalledWith({
      repoPath: "/repo",
      workspaceId: "repo",
      workspaceName: "repo",
    });
    deferred.resolve();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  test("starts one repository add when two submit events arrive before a rerender", async () => {
    const deferred = createDeferred<void>();
    const addWorkspace = mock(async () => deferred.promise);
    renderForm({ addWorkspace });
    await chooseRepository();
    const submitButton = screen.getByRole("button", { name: /^open repository$/i });

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(addWorkspace).toHaveBeenCalledTimes(1);
    deferred.resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^open repository$/i })).toBeTruthy(),
    );
  });

  test("shows add failures and lets the user retry without losing the draft", async () => {
    let attempts = 0;
    const addWorkspace = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Repository open failed");
    });
    const onSuccess = mock(() => {});
    renderForm({ addWorkspace, onSuccess });
    await chooseRepository();

    fireEvent.click(screen.getByRole("button", { name: /^open repository$/i }));
    await screen.findByText("Repository open failed");
    // SAFETY: This test creates the DOM fixture that supplies `HTMLInputElement` before this lookup.
    expect((screen.getByLabelText("Repository path") as HTMLInputElement).value).toBe("/repo");
    fireEvent.click(screen.getByRole("button", { name: /^open repository$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(addWorkspace).toHaveBeenCalledTimes(2);
  });
});
