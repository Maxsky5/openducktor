import { describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { IssueTypeGrid } from "./issue-type-grid";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function getButtonLabel(btn: ReactTestInstance): string | undefined {
  const labelParagraph = btn.findAllByType("p").find((p) => {
    const firstChild = p.children[0];
    return typeof firstChild === "string";
  });
  if (labelParagraph) {
    const firstChild = labelParagraph.children[0];
    return typeof firstChild === "string" ? firstChild : undefined;
  }
  return undefined;
}

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

  test("renders disabled state for epic with coming soon text", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    let root!: ReturnType<typeof create>;

    act(() => {
      root = create(
        <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
      );
    });

    const buttons = root.root.findAllByType("button");
    const epicCard = buttons.find((btn) => getButtonLabel(btn) === "Epic");

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    expect(epicCard.props.disabled).toBe(true);

    const paragraphs = epicCard.findAllByType("p");
    const descriptionParagraph = paragraphs.find((p) => {
      const firstChild = p.children[0];
      return typeof firstChild === "string" && firstChild.includes("Coming soon");
    });

    expect(descriptionParagraph).toBeDefined();
  });

  test("does not call onSelectIssueType when disabled option clicked", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    let root!: ReturnType<typeof create>;

    act(() => {
      root = create(
        <IssueTypeGrid selectedIssueType={null} onSelectIssueType={onSelectIssueType} />,
      );
    });

    const buttons = root.root.findAllByType("button");
    const epicCard = buttons.find((btn) => getButtonLabel(btn) === "Epic");

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    act(() => {
      epicCard.props.onClick();
    });

    expect(onSelectIssueType).not.toHaveBeenCalled();
  });
});
