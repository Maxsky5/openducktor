import { describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { IssueTypeGrid } from "./issue-type-grid";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function getButtonLabel(btn: ReactTestInstance): string | undefined {
  const labelParagraph = btn.findAllByType("p").find((p) => typeof p.children[0] === "string");
  return labelParagraph?.children[0] as string | undefined;
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

  test("disables the epic button when not selected", () => {
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
  });

  test("selected epic does not show disabled state", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const onSelectIssueType = mock(() => {});
    let root!: ReturnType<typeof create>;

    act(() => {
      root = create(
        <IssueTypeGrid selectedIssueType="epic" onSelectIssueType={onSelectIssueType} />,
      );
    });

    const buttons = root.root.findAllByType("button");
    const epicCard = buttons.find((btn) => getButtonLabel(btn) === "Epic");

    if (!epicCard) {
      throw new Error("expected epic card button");
    }

    // When selected, Epic should not be disabled
    expect(epicCard.props.disabled).toBe(false);

    // Should show the real description, not "Coming soon"
    const paragraphs = epicCard.findAllByType("p");
    const descriptionParagraph = paragraphs.find((p) => {
      const firstChild = p.children[0];
      return typeof firstChild === "string" && firstChild.includes("Large initiative");
    });

    expect(descriptionParagraph).toBeDefined();

    // Should show the checkmark indicator
    const checkSpan = epicCard.findAllByType("span").find((span) => {
      // The checkmark span has specific classes when selected
      return (
        span.props.className?.includes("border-info-border") ||
        span.props.className?.includes("border-destructive-border") ||
        span.props.className?.includes("border-pending-border") ||
        span.props.className?.includes("border-input")
      );
    });
    expect(checkSpan).toBeDefined();
  });
});
