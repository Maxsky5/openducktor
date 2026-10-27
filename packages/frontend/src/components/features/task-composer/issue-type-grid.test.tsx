import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { IssueTypeGrid } from "./issue-type-grid";

beforeEach(enableReactActEnvironment);

describe("IssueTypeGrid", () => {
  test("selects a type when a card is clicked", () => {
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
});
