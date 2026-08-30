import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { TaskDescriptionMathDialog } from "./task-description-math-dialog";

const pressEnter = (element: HTMLElement): void => {
  element.focus();
  const defaultAllowed = fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
  if (defaultAllowed) {
    if (element.tagName === "BUTTON") {
      fireEvent.click(element);
    } else {
      const form = element.closest<HTMLFormElement>("form");
      if (!form) {
        throw new Error("Expected the dialog field to belong to a form.");
      }
      fireEvent.submit(form);
    }
  }
};

describe("TaskDescriptionMathDialog", () => {
  test("lets a focused Cancel button handle Enter without saving", () => {
    const onCancel = mock(() => {});
    const onSubmit = mock((_latex: string) => true);
    const view = render(
      <TaskDescriptionMathDialog
        edit={{ kind: "inline", latex: "x" }}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    pressEnter(view.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("lets the focused submit button save with Enter", () => {
    const onSubmit = mock((_latex: string) => true);
    const view = render(
      <TaskDescriptionMathDialog
        edit={{ kind: "inline", latex: "x" }}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    pressEnter(view.getByRole("button", { name: "Insert formula" }));

    expect(onSubmit).toHaveBeenCalledWith("x");
  });

  test("lets the inline formula field use native Enter submission", () => {
    const onSubmit = mock((_latex: string) => true);
    const view = render(
      <TaskDescriptionMathDialog
        edit={{ kind: "inline", latex: "x" }}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    pressEnter(view.getByRole("textbox", { name: "LaTeX formula" }));

    expect(onSubmit).toHaveBeenCalledWith("x");
  });

  test.each([
    ["Ctrl+Enter", { ctrlKey: true }],
    ["Command+Enter", { metaKey: true }],
  ])("submits block math when %s starts in the formula field", (_shortcut, modifier) => {
    const onSubmit = mock((_latex: string) => true);
    const view = render(
      <TaskDescriptionMathDialog
        edit={{ kind: "block", latex: "x^2" }}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const field = view.getByRole("textbox", { name: "LaTeX formula" });

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter", ...modifier });
    expect(onSubmit).toHaveBeenCalledWith("x^2");
  });

  test("cancels with Escape", () => {
    const onCancel = mock(() => {});
    const view = render(
      <TaskDescriptionMathDialog
        edit={{ kind: "inline", latex: "x" }}
        onCancel={onCancel}
        onSubmit={() => true}
      />,
    );

    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
