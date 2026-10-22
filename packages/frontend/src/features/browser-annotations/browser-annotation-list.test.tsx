import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserAnnotationList, type BrowserAnnotationListProps } from "./browser-annotation-list";
import type { BrowserAnnotation, BrowserAnnotationChanges } from "./browser-annotation-store";
import { buildAnnotation, buildCapture } from "./browser-annotation-test-support";

const renderList = (
  annotations: BrowserAnnotation[],
  overrides: Partial<BrowserAnnotationListProps> = {},
) => {
  const props = {
    annotations,
    offPageIds: new Set<string>(),
    onSelect: mock((_annotation: BrowserAnnotation) => {}),
    onUpdate: mock((_annotation: BrowserAnnotation, _changes: BrowserAnnotationChanges) => {}),
    onRemove: mock((_annotation: BrowserAnnotation) => {}),
    ...overrides,
  };
  render(<BrowserAnnotationList {...props} />);
  return props;
};

const getButton = (name: string): HTMLButtonElement => {
  const button = screen.getByRole("button", { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected the ${name} button`);
  return button;
};

describe("BrowserAnnotationList", () => {
  test("shows the number, comment, element, page, and screenshot of each annotation", () => {
    const [element] = buildCapture().elements;
    if (!element) throw new Error("Expected an element fixture");
    renderList([
      buildAnnotation({ id: "a", number: 1, comment: "First comment" }),
      buildAnnotation({
        id: "b",
        number: 2,
        comment: "Second comment",
        includeScreenshot: false,
        page: { url: "http://localhost:3000/", title: " " },
        elements: [element, { ...element, tag: "footer" }],
      }),
    ]);

    const items = screen.getAllByTestId("browser-annotation-list-item");
    expect(items.map((item) => item.textContent)).toEqual([
      '1First commentbutton "Save"SettingsScreenshot',
      '2Second commentbutton "Save" and 1 morehttp://localhost:3000/',
    ]);
  });

  test("scrolls to an element on the page and marks an element that is not on the page", () => {
    const onPage = buildAnnotation({ id: "a", number: 1 });
    const offPage = buildAnnotation({ id: "b", number: 2 });
    const props = renderList([onPage, offPage], { offPageIds: new Set(["b"]) });

    fireEvent.click(getButton("Show annotation 1 on the page"));
    expect(props.onSelect).toHaveBeenCalledWith(onPage);
    expect(getButton("Show annotation 2 on the page").disabled).toBe(true);
    const [first, second] = screen.getAllByTestId("browser-annotation-list-item");
    expect(first?.textContent).not.toContain("Not on this page");
    expect(second?.textContent).toContain("Not on this page");
  });

  test("edits an annotation in place and removes an annotation", async () => {
    const annotation = buildAnnotation({ id: "a", number: 3, comment: "Old" });
    const props = renderList([annotation]);

    fireEvent.click(getButton("Edit annotation 3"));
    const box = screen.getByRole("form", { name: "Edit annotation" });
    fireEvent.change(within(box).getByRole("textbox", { name: "Annotation comment" }), {
      target: { value: "New" },
    });
    fireEvent.click(within(box).getByRole("switch", { name: "Screenshot" }));
    fireEvent.click(within(box).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(props.onUpdate).toHaveBeenCalledWith(annotation, {
        comment: "New",
        includeScreenshot: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit annotation" })).toBeNull());
    fireEvent.click(getButton("Remove annotation 3"));
    expect(props.onRemove).toHaveBeenCalledWith(annotation);
  });

  test("locks the actions of an annotation that is being sent", () => {
    renderList([buildAnnotation({ number: 1, status: "submitting" })]);

    expect(getButton("Edit annotation 1").disabled).toBe(true);
    expect(getButton("Remove annotation 1").disabled).toBe(true);
    expect(screen.getByTestId("browser-annotation-list-item").textContent).toContain("Sending");
  });

  test("explains how to add an annotation when none is pending", () => {
    renderList([]);

    expect(screen.getByText(/No pending annotations/).textContent).toBe(
      "No pending annotations. Turn on Annotate and click an element on the page.",
    );
  });
});
