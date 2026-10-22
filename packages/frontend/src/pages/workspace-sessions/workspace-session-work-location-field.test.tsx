import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Folder, GitBranch } from "lucide-react";
import { act, useState } from "react";
import { WorkspaceSessionWorkLocationField } from "./workspace-session-work-location-field";

test("selects work locations with arrow keys and keeps one radio in the tab order", async () => {
  function Harness() {
    const [location, setLocation] = useState("local_repo_root");
    return (
      <WorkspaceSessionWorkLocationField
        value={location}
        onValueChange={setLocation}
        options={[
          {
            value: "local_repo_root",
            label: "Current checkout",
            description: "Work with the files already here.",
            icon: Folder,
          },
          {
            value: "local_worktree",
            label: "New worktree",
            description: "Use an isolated directory and branch.",
            icon: GitBranch,
          },
        ]}
      />
    );
  }

  const rendered = render(<Harness />);
  try {
    const group = rendered.getByRole("radiogroup", { name: "Work location" });
    const current = rendered.getByRole("radio", { name: "Current checkout" });
    const worktree = rendered.getByRole("radio", { name: "New worktree" });
    const radios = [current, worktree];

    await act(async () => group.focus());
    expect(document.activeElement === current).toBe(true);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    expect(current.tabIndex).toBe(0);

    fireEvent.keyDown(current, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement === worktree).toBe(true);
      expect(worktree.getAttribute("aria-checked")).toBe("true");
      expect(current.getAttribute("aria-checked")).toBe("false");
      expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
      expect(worktree.tabIndex).toBe(0);
    });
    fireEvent.keyUp(worktree, { key: "ArrowRight" });

    fireEvent.keyDown(worktree, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(document.activeElement === current).toBe(true);
      expect(current.getAttribute("aria-checked")).toBe("true");
      expect(worktree.getAttribute("aria-checked")).toBe("false");
      expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
      expect(current.tabIndex).toBe(0);
    });
    fireEvent.keyUp(current, { key: "ArrowLeft" });
  } finally {
    rendered.unmount();
  }
});
