import { expect, test } from "bun:test";
import type { KanbanSettings } from "@openducktor/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SettingsKanbanSection } from "./settings-kanban-section";

function KanbanSettingsForm() {
  const [kanban, setKanban] = useState<KanbanSettings>({
    doneVisibleDays: 3,
    emptyColumnDisplay: "collapsed",
    taskCardView: "compact",
  });
  return <SettingsKanbanSection kanban={kanban} disabled={false} onUpdateKanban={setKanban} />;
}

test("edits the Kanban draft through its labeled controls", async () => {
  render(<KanbanSettingsForm />);

  const visibleDays = screen.getByRole<HTMLInputElement>("spinbutton", {
    name: "Done tasks visible for",
  });
  expect(visibleDays.value).toBe("3");
  fireEvent.change(visibleDays, { target: { value: "-1" } });
  expect(visibleDays.value).toBe("0");

  const emptyColumns = screen.getByRole("button", { name: "Empty columns" });
  expect(emptyColumns.textContent).toContain("Collapsed");
  await act(async () => {
    fireEvent.click(emptyColumns);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: /Hidden/ }));
  });
  expect(emptyColumns.textContent).toContain("Hidden");

  expect(screen.getByRole("radio", { name: "Compact", checked: true })).toBeDefined();
  fireEvent.click(screen.getByRole("radio", { name: "Normal", checked: false }));
  expect(screen.getByRole("radio", { name: "Normal", checked: true })).toBeDefined();
  expect(visibleDays.value).toBe("0");
  expect(emptyColumns.textContent).toContain("Hidden");
});
