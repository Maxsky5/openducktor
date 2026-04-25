import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { IssueTypeGrid } from "./issue-type-grid";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("IssueTypeGrid", () => {
  test("selects a type when a card is clicked", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    const { unmount } = render(
      <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
    );

    const featureCard = screen.getAllByRole("button")[0];
    if (!featureCard) {
      throw new Error("expected feature card button");
    }

    fireEvent.click(featureCard);

    expect(onSelectIssueType).toHaveBeenCalledWith("feature");
    unmount();
  });

  test("renders disabled state for epic with coming soon text", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    const { container, unmount } = render(
      <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
    );

    const epicCard = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Epic"),
    );

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    expect(epicCard.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    unmount();
  });

  test("disables the epic button when not selected", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    const { container, unmount } = render(
      <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
    );

    const epicCard = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Epic"),
    );

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    expect(epicCard.hasAttribute("disabled")).toBe(true);
    unmount();
  });

  test("selected epic does not show disabled state", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    const { container, unmount } = render(
      <IssueTypeGrid selectedIssueType="epic" onSelectIssueType={onSelectIssueType} />,
    );

    const epicCard = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Epic"),
    );

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    // When selected, Epic should not be disabled
    expect(epicCard.hasAttribute("disabled")).toBe(false);

    expect(screen.getByText(/large initiative/i)).toBeTruthy();
    const checkSpan = Array.from(container.querySelectorAll("span")).find((span) =>
      [
        "border-info-border",
        "border-destructive-border",
        "border-pending-border",
        "border-input",
      ].some((className) => span.className.includes(className)),
    );
    expect(checkSpan).toBeDefined();
    unmount();
  });
});
