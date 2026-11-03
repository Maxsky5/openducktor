import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalViewportNotices } from "./terminal-notice";

test("shows a nonzero exit as neutral status that stays dismissed when the host sends it again", () => {
  const notices = (exitText: string | null) => (
    <TerminalViewportNotices attention={null} exitText={exitText} />
  );
  const view = render(notices("Exited with code 1."));
  const status = screen.getByRole("status", { name: "Terminal exit status" });
  expect(status.textContent).toBe("Exited with code 1.");
  expect(status.parentElement?.className).toContain("bg-muted");

  fireEvent.click(screen.getByRole("button", { name: "Dismiss terminal exit status" }));
  expect(screen.queryByRole("status")).toBeNull();
  // A reattach sends the same exit again.
  view.rerender(notices("Exited with code 1."));
  expect(screen.queryByRole("status")).toBeNull();
});

test("shows a terminal problem as its own warning that stays dismissed when the host sends it again", () => {
  const notices = (attention: string) => (
    <TerminalViewportNotices attention={attention} exitText="Exited with code 0." />
  );
  const view = render(notices("Output overflow stopped this terminal."));
  expect(screen.getByRole("alert", { name: "Terminal problem" }).textContent).toBe(
    "Output overflow stopped this terminal.",
  );
  expect(screen.getByRole("status", { name: "Terminal exit status" })).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Dismiss terminal problem" }));
  expect(screen.queryByRole("alert")).toBeNull();
  // A reattach sends the same failure again.
  view.rerender(notices("Output overflow stopped this terminal."));
  expect(screen.queryByRole("alert")).toBeNull();
  view.rerender(notices("Terminal transport failed."));
  expect(screen.getByRole("alert").textContent).toBe("Terminal transport failed.");
});
