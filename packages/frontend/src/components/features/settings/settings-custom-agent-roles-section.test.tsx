import { expect, test } from "bun:test";
import type { CustomAgentRole } from "@openducktor/contracts";
import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { validateCustomAgentRoleDrafts } from "@/state/read-models/custom-agent-role-settings";
import { SettingsCustomAgentRolesSection } from "./settings-custom-agent-roles-section";

function RoleDraft({
  initial = [],
  disabled = false,
}: {
  initial?: CustomAgentRole[];
  disabled?: boolean;
}) {
  const [roles, setRoles] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <SettingsCustomAgentRolesSection
      roles={roles}
      selectedRoleId={selected}
      validation={validateCustomAgentRoleDrafts(roles)}
      disabled={disabled}
      onSelect={setSelected}
      onUpdate={setRoles}
    />
  );
}

test("adds local drafts, focuses the name, keeps edits across selection, and deletes the adjacent draft", () => {
  const view = render(<RoleDraft />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Add custom agent role" }));
    expect(document.activeElement).toBe(view.getByLabelText("Name"));
    expect(view.getByText("Role name is required.")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Reviewer" } });
    fireEvent.change(view.getByLabelText("System prompt"), { target: { value: "Review code.\n" } });
    fireEvent.click(view.getByRole("button", { name: "Add role" }));
    expect(document.activeElement).toBe(view.getByLabelText("Name"));
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Researcher" } });
    fireEvent.click(view.getByRole("button", { name: "Reviewer" }));
    expect(view.container.querySelector("textarea")?.value).toBe("Review code.\n");
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    expect(view.getByRole("dialog", { name: "Delete custom agent role" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.getByDisplayValue("Reviewer")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    fireEvent.click(view.getByRole("button", { name: "Delete role" }));
    expect(view.getByDisplayValue("Researcher")).toBeTruthy();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByRole("button", { name: "Save role" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    fireEvent.click(view.getByRole("button", { name: "Delete role" }));
    expect(view.getByText("Create your first custom agent role")).toBeTruthy();
  } finally {
    view.unmount();
  }
});

test("disables every role control while settings are saving", () => {
  const view = render(
    <RoleDraft disabled initial={[{ id: "one", name: "Reviewer", systemPrompt: "Review." }]} />,
  );
  try {
    for (const control of view.container.querySelectorAll("button, input, textarea")) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  } finally {
    view.unmount();
  }
});
