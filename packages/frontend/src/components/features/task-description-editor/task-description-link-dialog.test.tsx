import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { TaskDescriptionLinkDialog } from "./task-description-link-dialog";

const pressEnter = (element: HTMLElement): void => {
  element.focus();
  const defaultAllowed = fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
  if (defaultAllowed) {
    if (element.tagName === "BUTTON") {
      fireEvent.click(element);
    } else {
      fireEvent.submit(element.closest("form") as HTMLFormElement);
    }
  }
};

describe("TaskDescriptionLinkDialog", () => {
  test("validates unsafe or lossy destinations before insertion", async () => {
    const onSubmit = mock((_href: string) => true);
    const view = render(
      <TaskDescriptionLinkDialog
        href=""
        onCancel={() => {}}
        onRemove={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const input = view.getByRole("textbox", { name: "Link destination" });
    fireEvent.change(input, { target: { value: "https://x.test/a b" } });
    fireEvent.click(view.getByRole("button", { name: "Insert link" }));

    expect((await view.findByRole("alert")).textContent).toContain("spaces");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("saves a valid destination with Enter", () => {
    const onSubmit = mock((_href: string) => true);
    const view = render(
      <TaskDescriptionLinkDialog
        href=""
        onCancel={() => {}}
        onRemove={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const input = view.getByRole("textbox", { name: "Link destination" });
    fireEvent.change(input, { target: { value: "https://example.com/docs" } });
    pressEnter(input);

    expect(onSubmit).toHaveBeenCalledWith("https://example.com/docs");
  });

  test("edits or removes the selected link", () => {
    const onSubmit = mock((_href: string) => true);
    const onRemove = mock(() => {});
    const view = render(
      <TaskDescriptionLinkDialog
        href="https://example.com/old"
        onCancel={() => {}}
        onRemove={onRemove}
        onSubmit={onSubmit}
      />,
    );

    const input = view.getByRole("textbox", { name: "Link destination" });
    expect((input as HTMLInputElement).value).toBe("https://example.com/old");
    fireEvent.change(input, { target: { value: "https://example.com/new" } });
    fireEvent.click(view.getByRole("button", { name: "Save link" }));
    expect(onSubmit).toHaveBeenCalledWith("https://example.com/new");

    fireEvent.click(view.getByRole("button", { name: "Remove link" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["Remove link", "remove"],
    ["Cancel", "cancel"],
  ] as const)("lets focused %s handle Enter without saving", (buttonName, expectedAction) => {
    const onCancel = mock(() => {});
    const onRemove = mock(() => {});
    const onSubmit = mock((_href: string) => true);
    const view = render(
      <TaskDescriptionLinkDialog
        href="https://example.com/old"
        onCancel={onCancel}
        onRemove={onRemove}
        onSubmit={onSubmit}
      />,
    );

    pressEnter(view.getByRole("button", { name: buttonName }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(expectedAction === "remove" ? 1 : 0);
    expect(onCancel).toHaveBeenCalledTimes(expectedAction === "cancel" ? 1 : 0);
  });

  test("lets the focused submit button save with Enter", () => {
    const onSubmit = mock((_href: string) => true);
    const view = render(
      <TaskDescriptionLinkDialog
        href="https://example.com/docs"
        onCancel={() => {}}
        onRemove={() => {}}
        onSubmit={onSubmit}
      />,
    );

    pressEnter(view.getByRole("button", { name: "Save link" }));

    expect(onSubmit).toHaveBeenCalledWith("https://example.com/docs");
  });

  test("cancels with Escape", () => {
    const onCancel = mock(() => {});
    const view = render(
      <TaskDescriptionLinkDialog
        href=""
        onCancel={onCancel}
        onRemove={() => {}}
        onSubmit={() => true}
      />,
    );

    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
