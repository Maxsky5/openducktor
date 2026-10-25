import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleCard } from "./collapsible-card";

const isShown = (text: string): boolean => {
  const element = screen.queryByText(text);
  return element !== null && element.closest("[data-state=closed]") === null;
};

describe("CollapsibleCard", () => {
  test("toggles from the header and reports its state", () => {
    const view = render(
      <CollapsibleCard title="Metadata" icon={<span />} summary="3">
        <p>Body</p>
      </CollapsibleCard>,
    );
    const header = screen.getByRole("button", { name: "Metadata 3" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(isShown("Body")).toBe(false);

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(isShown("Body")).toBe(true);

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(isShown("Body")).toBe(false);
    view.unmount();
  });

  test("runs a header action without toggling the card", () => {
    const onAction = mock(() => {});
    const view = render(
      <CollapsibleCard
        title="Artifacts"
        icon={<span />}
        defaultExpanded
        headerAction={
          <button type="button" onClick={onAction}>
            Add
          </button>
        }
      >
        <p>Body</p>
      </CollapsibleCard>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Artifacts" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    view.unmount();
  });

  test("stays open after its default turns false", () => {
    const card = (defaultExpanded: boolean) => (
      <CollapsibleCard title="Artifacts" icon={<span />} defaultExpanded={defaultExpanded}>
        <p>Body</p>
      </CollapsibleCard>
    );
    const view = render(card(false));
    const header = screen.getByRole("button", { name: "Artifacts" });
    expect(header.getAttribute("aria-expanded")).toBe("false");

    view.rerender(card(true));
    expect(header.getAttribute("aria-expanded")).toBe("true");

    view.rerender(card(false));
    expect(header.getAttribute("aria-expanded")).toBe("true");
    view.unmount();
  });
});
