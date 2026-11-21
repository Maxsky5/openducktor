import { describe, expect, mock, test } from "bun:test";
import type { WorkflowCondition, WorkflowDocument } from "@openducktor/contracts";
import { newWorkflowDocument } from "@openducktor/workflows";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { conditionKindBlocker, conditionOfKind, conditionKind } from "../model/conditions";
import { addState } from "../model/create-elements";
import { addArtifact } from "../model/document-edits";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConditionEditor, ConditionField } from "./condition-builder";
import { elementOptions } from "./element-options";
import { InspectorContext, type InspectorContextValue } from "./inspector-context";

const reviewDocument = (): WorkflowDocument => {
  let document = newWorkflowDocument("flow", "Flow");
  document = addState(document, "Review").document;
  document = addArtifact(document, "Spec", "document").document;
  document = addArtifact(document, "QA report", "review").document;
  return document;
};

const contextOf = (
  document: WorkflowDocument,
  problemPaths: string[] = [],
): InspectorContextValue => ({
  readOnly: false,
  document,
  elementKey: "step:build",
  problemPaths: new Set(problemPaths),
  change: () => {},
  rename: () => {},
  create: () => {},
  select: () => {},
  options: elementOptions(document, []),
  catalogRoles: [],
  roles: { newRole: () => {}, editRole: () => {}, duplicateRole: () => {} },
  published: false,
  takenWorkflowIds: new Set(),
});

function Harness({
  condition,
  onChange,
  problemPaths,
}: {
  condition: WorkflowCondition;
  onChange: (condition: WorkflowCondition) => void;
  problemPaths?: string[];
}): ReactElement {
  return (
    <InspectorContext value={contextOf(reviewDocument(), problemPaths)}>
      <TooltipProvider>
        <ConditionEditor
          condition={condition}
          path={["requiredWhen"]}
          name="Required when"
          onChange={onChange}
        />
      </TooltipProvider>
    </InspectorContext>
  );
}

describe("condition kinds", () => {
  const definition = reviewDocument().definition;

  test("each kind starts from declared elements", () => {
    expect(conditionOfKind("issueType", true, definition)).toEqual({
      fact: "issueType",
      equals: definition.issueTypes[0]!.id,
    });
    expect(conditionOfKind("present", true, definition)).toEqual({
      artifact: "spec",
      present: true,
    });
    expect(conditionOfKind("verdict", true, definition)).toEqual({
      artifact: "qa_report",
      verdict: "approved",
    });
    expect(conditionOfKind("stateIn", true, definition)).toEqual({ stateIn: [] });
  });

  test("a group or a negation keeps the previous condition as its part", () => {
    const previous: WorkflowCondition = { stateIn: ["review"] };
    expect(conditionOfKind("all", previous, definition)).toEqual({ all: [previous] });
    expect(conditionOfKind("any", previous, definition)).toEqual({ any: [previous] });
    expect(conditionOfKind("not", previous, definition)).toEqual({ not: previous });
  });

  test("an artifact test keeps its artifact when it turns from present to absent", () => {
    expect(conditionOfKind("absent", { artifact: "qa_report", present: true }, definition)).toEqual(
      { artifact: "qa_report", present: false },
    );
  });

  test("a kind that needs an undeclared element names what to add", () => {
    const empty = newWorkflowDocument("flow", "Flow").definition;
    expect(conditionKindBlocker("verdict", empty)).toBe("Add a review artifact first.");
    expect(conditionKindBlocker("present", empty)).toBe("Add an artifact first.");
    expect(conditionKindBlocker("issueType", { ...empty, issueTypes: [] })).toBe(
      "Add a supported issue type first.",
    );
    expect(conditionKindBlocker("all", empty)).toBeUndefined();
  });

  test("reads the kind of every condition", () => {
    expect(conditionKind(true)).toBe("always");
    expect(conditionKind(false)).toBe("never");
    expect(conditionKind({ artifact: "spec", present: false })).toBe("absent");
    expect(conditionKind({ any: [] })).toBe("any");
  });
});

describe("condition builder", () => {
  const nested: WorkflowCondition = {
    all: [{ stateIn: ["open", "review"] }, { not: { artifact: "spec", present: true } }],
  };

  test("edits nested parts and gives each part its field path", () => {
    const { container } = render(<Harness condition={nested} onChange={() => {}} />);
    const paths = [...container.querySelectorAll("[data-field-path]")].map((element) =>
      element.getAttribute("data-field-path"),
    );
    expect(paths).toContain("requiredWhen");
    expect(paths).toContain("requiredWhen.all[0].stateIn");
    expect(paths).toContain("requiredWhen.all[1].not");
    expect(paths).toContain("requiredWhen.all[1].not.artifact");
  });

  test("removes a part of a group", () => {
    const onChange = mock((_condition: WorkflowCondition) => {});
    render(<Harness condition={nested} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Required when, part 1" }));
    expect(onChange).toHaveBeenCalledWith({ all: [{ not: { artifact: "spec", present: true } }] });
  });

  test("adds a part that always matches", () => {
    const onChange = mock((_condition: WorkflowCondition) => {});
    render(<Harness condition={{ any: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Any of these" }));
    expect(onChange).toHaveBeenCalledWith({ any: [true] });
  });

  test("removes a state from a state test", () => {
    const onChange = mock((_condition: WorkflowCondition) => {});
    render(<Harness condition={{ stateIn: ["open", "review"] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Backlog" }));
    expect(onChange).toHaveBeenCalledWith({ stateIn: ["review"] });
  });

  test("shows a state that the document does not declare", () => {
    render(<Harness condition={{ stateIn: ["deleted"] }} onChange={() => {}} />);
    expect(screen.getByTitle("This workflow does not have it. Remove it.").textContent).toBe(
      "deleted",
    );
  });

  test("marks a part with a problem", () => {
    const { container } = render(
      <Harness condition={nested} onChange={() => {}} problemPaths={["requiredWhen.all[1].not"]} />,
    );
    // A one-value test marks its pill. A group marks its rail.
    const part = container.querySelector('[data-field-path="requiredWhen.all[1].not"]');
    expect(part?.querySelector("button")?.className).toContain("ring-destructive");
  });
});

describe("condition field", () => {
  test("renders a single test and a group with its plain reading", () => {
    const field = (value: WorkflowCondition) => (
      <InspectorContext value={contextOf(reviewDocument())}>
        <TooltipProvider>
          <ConditionField
            label="Required when"
            path={["requiredWhen"]}
            value={value}
            onChange={() => {}}
          />
        </TooltipProvider>
      </InspectorContext>
    );
    const { rerender } = render(field(true));
    expect(screen.queryByText(/When any of these holds/)).toBeNull();
    rerender(field({ any: [{ stateIn: ["open"] }, false] }));
    expect(screen.getByText("When any of these holds:")).toBeTruthy();
    expect(screen.getByText("The task is in Backlog")).toBeTruthy();
  });
});
