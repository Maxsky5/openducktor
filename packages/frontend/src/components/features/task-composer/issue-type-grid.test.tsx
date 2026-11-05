import { specPlanBuildWorkflow } from "@openducktor/workflows";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { IssueTypeGrid } from "./issue-type-grid";

beforeEach(enableReactActEnvironment);

describe("IssueTypeGrid", () => {
  test("selects a type when a card is clicked", () => {
    const onSelectIssueType = mock(() => {});
    const { unmount } = render(
      <IssueTypeGrid
        choices={specPlanBuildWorkflow.definition.issueTypes.map(
          ({ id, label, description, icon }) => ({
            value: id,
            label,
            description: description ?? "",
            icon,
          }),
        )}
        selectedIssueType={null}
        onSelectIssueType={onSelectIssueType}
      />,
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
