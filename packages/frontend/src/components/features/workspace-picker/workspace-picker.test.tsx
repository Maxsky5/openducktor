import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";
import { WorkspacePicker } from "./workspace-picker";

const fieldnotes = createWorkspaceRecordFixture({
  workspaceId: "fieldnotes",
  workspaceName: "fieldnotes",
  repoPath: "/work/fieldnotes",
});
const emptyQa = createWorkspaceRecordFixture({
  workspaceId: "empty-qa",
  workspaceName: "odt37-empty-qa",
  repoPath: "/private/tmp/odt37-empty-qa",
});
const layoutQa = createWorkspaceRecordFixture({
  workspaceId: "layout-qa",
  workspaceName: "odt37-ios-layout-qa",
  repoPath: "/private/tmp/odt37-ios-layout-qa",
});

const openPicker = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("WorkspacePicker", () => {
  test("filters by words of the name or of a folder in the path", async () => {
    render(
      <WorkspacePicker
        workspaces={[fieldnotes, emptyQa, layoutQa]}
        value="fieldnotes"
        onValueChange={() => {}}
        label="Workspace"
        variant="field"
      />,
    );
    await openPicker("Workspace: fieldnotes");

    const search = screen.getByPlaceholderText("Filter workspaces…");
    await act(async () => {
      fireEvent.change(search, { target: { value: "empty" } });
    });
    // "empty" has the letters of "private tmp ... layout" in order, but no word that holds it.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "odt37-empty-qa" })).toBeTruthy();

    await act(async () => {
      fireEvent.change(search, { target: { value: "tmp layout" } });
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "odt37-ios-layout-qa" })).toBeTruthy();
  });

  test("chooses All workspaces as null and shows its icon on the trigger", async () => {
    const chosen: Array<string | null> = [];
    render(
      <WorkspacePicker
        workspaces={[fieldnotes, emptyQa]}
        value="fieldnotes"
        allowAll
        onValueChange={(workspaceId) => chosen.push(workspaceId)}
        label="Workspace filter"
        variant="chip"
      />,
    );
    await openPicker("Workspace filter: fieldnotes");

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "All workspaces" }));
    });

    expect(chosen).toEqual([null]);
  });

  test("shows a repository path only when two workspaces share a name", async () => {
    const fork = createWorkspaceRecordFixture({
      workspaceId: "fieldnotes-fork",
      workspaceName: "fieldnotes",
      repoPath: "/forks/fieldnotes",
    });
    render(
      <WorkspacePicker
        workspaces={[fieldnotes, fork, emptyQa]}
        value={null}
        onValueChange={() => {}}
        label="Workspace"
        variant="inline"
      />,
    );
    await openPicker("Workspace: Choose a workspace");

    expect(screen.getByText("/work/fieldnotes")).toBeTruthy();
    expect(screen.getByText("/forks/fieldnotes")).toBeTruthy();
    expect(screen.queryByText("/private/tmp/odt37-empty-qa")).toBeNull();
  });

  test("shows the error count of a workspace", async () => {
    render(
      <WorkspacePicker
        workspaces={[fieldnotes, emptyQa]}
        value="fieldnotes"
        onValueChange={() => {}}
        errorCountByWorkspaceId={{ "empty-qa": 2 }}
        label="Repository"
        variant="field"
      />,
    );
    await openPicker("Repository: fieldnotes");

    expect(screen.getByRole("option", { name: /odt37-empty-qa/ }).textContent).toContain(
      "2 errors",
    );
  });
});
