import { expect, jest, test } from "bun:test";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

setupTestingLibraryFakeTimers();

function Form() {
  const [value, setValue] = useState("");
  return (
    <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

test("reveals prepared content and actions together after at least 500 ms and keeps form state", () => {
  const dialog = (loading: boolean) => (
    <Dialog open>
      <DialogContent loading={loading}>
        <DialogHeader>
          <DialogTitle>Prepare a task</DialogTitle>
          <DialogDescription>Check the task before continuing.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Form />
        </DialogBody>
        <DialogFooter>
          <button type="button">Confirm task</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  const view = render(dialog(false));
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
    target: { value: "Keep me" },
  });
  view.rerender(dialog(true));
  expect(screen.getByRole("status")).toBeDefined();
  expect(screen.getByRole("status").closest('[data-slot="dialog-body"]')).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Prepare a task" })).toBeDefined();
  expect(screen.getByText("Check the task before continuing.")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Confirm task" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  view.rerender(dialog(false));
  expect(screen.queryByRole("button", { name: "Confirm task" })).toBeNull();
  act(() => jest.advanceTimersByTime(499));
  expect(screen.queryByRole("button", { name: "Confirm task" })).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("Keep me");
  expect(screen.getByRole("button", { name: "Confirm task" })).toBeDefined();
});

test("shows ready content at once and gives a reopened dialog its own loading interval", () => {
  const dialog = (open: boolean, loading: boolean) => (
    <Dialog open={open}>
      <DialogContent loading={loading}>
        <DialogHeader>
          <DialogTitle>Load a task</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p role="alert">The read failed. Retry the read.</p>
          <button type="button">Retry</button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
  const view = render(dialog(true, false));
  expect(screen.getByRole("alert")).toBeDefined();
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(dialog(true, true));
  act(() => jest.advanceTimersByTime(100));
  view.rerender(dialog(false, true));
  view.rerender(dialog(true, true));
  view.rerender(dialog(true, false));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  act(() => jest.advanceTimersByTime(499));
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  expect(screen.getByRole("alert").textContent).toContain("Retry the read");
});
