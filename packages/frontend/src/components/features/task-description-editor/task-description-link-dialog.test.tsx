import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { TaskDescriptionLinkDialog } from "./task-description-link-dialog";

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
    fireEvent.keyDown(input, { key: "Enter" });

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
});
