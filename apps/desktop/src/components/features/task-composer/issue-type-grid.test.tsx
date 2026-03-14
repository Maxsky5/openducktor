import { describe, expect, mock, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { IssueTypeGrid } from "./issue-type-grid";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("IssueTypeGrid", () => {
  test("selects a type when a card is clicked", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    let root!: ReturnType<typeof create>;

    act(() => {
      root = create(
        <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
      );
    });

    const featureCard = root.root.findAllByType("button")[0];
    if (!featureCard) {
      throw new Error("expected feature card button");
    }

    act(() => {
      featureCard.props.onClick();
    });

    expect(onSelectIssueType).toHaveBeenCalledWith("feature");
  });
});
