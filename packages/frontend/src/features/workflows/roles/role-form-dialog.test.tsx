import { describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { useRoleFormDialog } from "./role-form-dialog";
import { newRoleInput } from "./role-input";

function Harness(): ReactElement {
  const { openRole, dialog } = useRoleFormDialog([]);
  return (
    <>
      <button type="button" onClick={() => openRole({ mode: "create", input: newRoleInput([]) })}>
        New role
      </button>
      {dialog}
    </>
  );
}

const openNewRole = () => {
  render(
    <QueryProvider connection={createTestClientConnection({ client: {} })}>
      <Harness />
    </QueryProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New role" }));
  return screen.getByRole("dialog");
};

const moreOptions = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: /^More options/ });

describe("role form", () => {
  test("groups the tools with plain names and keeps the tool name in the tooltip", () => {
    const dialog = openNewRole();
    for (const group of ["Task tools", "Workflow tools", "Browser tools"])
      expect(within(dialog).getByRole("group", { name: group })).toBeTruthy();
    const workflowTools = within(dialog).getByRole("group", { name: "Workflow tools" });
    expect(within(workflowTools).getByText("Move the task").closest("label")?.title).toBe(
      "odt_apply_workflow_event",
    );
    expect(within(workflowTools).getAllByRole("checkbox")[0]!.getAttribute("data-state")).toBe(
      "checked",
    );
  });

  test("sets the file access with two plain choices", () => {
    const dialog = openNewRole();
    const readOnly = within(dialog).getByRole("radio", { name: /^Read only/ });
    expect(readOnly.getAttribute("data-state")).toBe("checked");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Can edit files/ }));
    expect(readOnly.getAttribute("data-state")).toBe("unchecked");
    expect(within(dialog).queryByText(/worktree/i)).toBeNull();
  });

  test("shows the role ID beside the name, and keeps the icon, the side panel, and the scopes under More options", () => {
    const dialog = openNewRole();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Verifier" } });
    expect(within(dialog).getByLabelText("Role ID")).toHaveProperty("value", "verifier");
    expect(within(dialog).queryByText("Default side panel")).toBeNull();
    expect(moreOptions(dialog).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(moreOptions(dialog));
    expect(within(dialog).getByText("Default side panel")).toBeTruthy();
    expect(within(dialog).getByText("Runtime scopes")).toBeTruthy();
  });

  test("selects and clears a whole tool group", () => {
    const dialog = openNewRole();
    const browserTools = within(dialog).getByRole("group", { name: "Browser tools" });
    const states = () =>
      within(browserTools)
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("data-state"));
    fireEvent.click(within(browserTools).getByRole("button", { name: "Select all browser tools" }));
    expect(states().every((state) => state === "checked")).toBe(true);
    fireEvent.click(within(browserTools).getByRole("button", { name: "Clear browser tools" }));
    expect(states().every((state) => state === "unchecked")).toBe(true);
  });

  test("offers Save role without a note in the footer", () => {
    const dialog = openNewRole();
    expect(within(dialog).queryByText(/Undo cannot reverse it/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Save role" })).toBeTruthy();
  });
});
