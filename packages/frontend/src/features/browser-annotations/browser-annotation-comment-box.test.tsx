import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserAnnotationCommentBox } from "./browser-annotation-comment-box";
import type { BrowserAnnotationChanges } from "./browser-annotation-store";

const getButton = (name: string): HTMLButtonElement => {
  const button = screen.getByRole("button", { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected the ${name} button`);
  return button;
};

const typeComment = (value: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name: "Annotation comment" }), {
    target: { value },
  });
};

describe("BrowserAnnotationCommentBox", () => {
  test("keeps Save disabled until the comment has text and sends the screenshot by default", async () => {
    const onSave = mock((_value: BrowserAnnotationChanges) => {});
    render(
      <BrowserAnnotationCommentBox
        mode="create"
        targetLabel="SaveButton"
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Annotation comment" }),
    );
    expect(screen.getByRole("switch", { name: "Screenshot" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(getButton("Save").disabled).toBe(true);
    typeComment("  \n ");
    expect(getButton("Save").disabled).toBe(true);
    typeComment("Make it blue");
    fireEvent.click(getButton("Save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ comment: "Make it blue", includeScreenshot: true }),
    );
  });

  test("edits an existing comment and screenshot choice and saves with Mod+Enter", async () => {
    const onSave = mock((_value: BrowserAnnotationChanges) => {});
    render(
      <BrowserAnnotationCommentBox
        mode="edit"
        targetLabel="2 elements"
        initialComment="Old comment"
        initialIncludeScreenshot
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("form", { name: "Edit annotation" })).not.toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Screenshot" }));
    typeComment("New comment");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Annotation comment" }), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ comment: "New comment", includeScreenshot: false }),
    );
  });

  test("cancels with the Cancel button or with Escape, which does not reach the page", () => {
    const onCancel = mock(() => {});
    const onDocumentKeyDown = mock(() => {});
    document.addEventListener("keydown", onDocumentKeyDown);
    try {
      render(
        <BrowserAnnotationCommentBox
          mode="create"
          targetLabel="SaveButton"
          onSave={() => {}}
          onCancel={onCancel}
        />,
      );

      fireEvent.click(getButton("Cancel"));
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Annotation comment" }), {
        key: "Escape",
      });

      expect(onCancel).toHaveBeenCalledTimes(2);
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  test("locks the form while it saves and keeps it open with the error after a failure", async () => {
    const save = Promise.withResolvers<void>();
    render(
      <BrowserAnnotationCommentBox
        mode="create"
        targetLabel="SaveButton"
        onSave={() => save.promise}
        onCancel={() => {}}
      />,
    );
    typeComment("Comment");
    fireEvent.click(getButton("Save"));

    await waitFor(() => expect(getButton("Cancel").disabled).toBe(true));
    expect(getButton("Save").disabled).toBe(true);
    save.reject(new Error("The page closed before the capture finished."));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The page closed before the capture finished.",
      ),
    );
    expect(getButton("Save").disabled).toBe(false);
    expect(
      screen.getByRole("textbox", { name: "Annotation comment" }).getAttribute("aria-invalid"),
    ).toBe("true");
  });
});
