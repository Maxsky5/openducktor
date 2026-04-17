import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act, useState } from "react";
import { TagSelector } from "./tag-selector";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TagSelector", () => {
  test("creates a new normalized label from the input", async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const labels: string[][] = [];

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

    const rendered = render(<Harness />);

    const input = rendered.getByRole("textbox");

    await act(async () => {
      fireEvent.input(input, { target: { value: "Needs QA" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(labels.at(-1)).toEqual(["backend", "needs-qa"]);
  });

  test("does not create a label when tabbing out of the input", async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const labels: string[][] = [];

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

    const rendered = render(<Harness />);

    const input = rendered.getByRole("textbox");

    await act(async () => {
      fireEvent.input(input, { target: { value: "Needs QA" } });
      fireEvent.keyDown(input, { key: "Tab" });
    });

    expect(labels).toEqual([]);
  });

  test("prevents empty enter from bubbling to the parent form", async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let prevented = false;

    function Harness() {
      const [value, setValue] = useState(["backend"]);
      return (
        <TagSelector
          value={value}
          suggestions={["frontend", "design-system"]}
          onChange={setValue}
        />
      );
    }

    const rendered = render(<Harness />);

    const input = rendered.getByRole("textbox");

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    const originalPreventDefault = event.preventDefault.bind(event);
    event.preventDefault = () => {
      prevented = true;
      originalPreventDefault();
    };

    await act(async () => {
      input.dispatchEvent(event);
    });

    expect(prevented).toBe(true);
  });

  test("renders selected labels with the shared chip and preserves removal behavior", async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    function Harness() {
      const [value, setValue] = useState(["backend", "frontend"]);
      return <TagSelector value={value} suggestions={[]} onChange={setValue} />;
    }

    const rendered = render(<Harness />);

    expect(rendered.container.querySelectorAll("svg.lucide-tag")).toHaveLength(2);

    await act(async () => {
      fireEvent.click(rendered.getByLabelText("Remove label backend"));
    });

    expect(rendered.queryByText("backend")).toBeNull();
    expect(rendered.getByText("frontend")).toBeTruthy();
  });
});
