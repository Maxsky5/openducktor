import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TagSelector } from "./tag-selector";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TagSelector", () => {
  test("creates a new normalized label from the input", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const labels: string[][] = [];
    let renderer!: ReactTestRenderer;

    function Harness() {
      const [value, setValue] = useState(["backend"]);
      return (
        <TagSelector
          value={value}
          suggestions={["frontend", "design-system"]}
          onChange={(next) => {
            labels.push(next);
            setValue(next);
          }}
        />
      );
    }

    act(() => {
      renderer = create(<Harness />);
    });

    const input = renderer.root.findByType("input");

    act(() => {
      input.props.onChange({ currentTarget: { value: "Needs QA" } });
    });

    act(() => {
      input.props.onKeyDown({
        key: "Enter",
        preventDefault() {},
      });
    });

    expect(labels.at(-1)).toEqual(["backend", "needs-qa"]);
  });

  test("does not create a label when tabbing out of the input", () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const labels: string[][] = [];
    let renderer!: ReactTestRenderer;

    function Harness() {
      const [value, setValue] = useState(["backend"]);
      return (
        <TagSelector
          value={value}
          suggestions={["frontend", "design-system"]}
          onChange={(next) => {
            labels.push(next);
            setValue(next);
          }}
        />
      );
    }

    act(() => {
      renderer = create(<Harness />);
    });

    const input = renderer.root.findByType("input");

    act(() => {
      input.props.onChange({ currentTarget: { value: "Needs QA" } });
      input.props.onKeyDown({
        key: "Tab",
        preventDefault() {
          throw new Error("tab should not be intercepted");
        },
      });
    });

    expect(labels).toEqual([]);
  });
});
