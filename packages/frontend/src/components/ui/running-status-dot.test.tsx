import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { RunningStatusDot } from "./running-status-dot";

describe("RunningStatusDot", () => {
  test("preserves the original Studio SVG geometry for md and default and a solid 10px sm dot", () => {
    const { getByTestId } = render(
      <>
        <RunningStatusDot size="sm" data-testid="small" />
        <RunningStatusDot size="md" data-testid="medium" />
        <RunningStatusDot data-testid="default" />
      </>,
    );
    const small = getByTestId("small");
    const medium = getByTestId("medium");
    const defaultDot = getByTestId("default");

    expect(small.classList.contains("size-2.5")).toBe(true);
    expect(medium.classList.contains("size-3.5")).toBe(true);
    expect(defaultDot.className).toBe(medium.className);
    expect(small.tagName).toBe(medium.tagName);
    for (const dot of [medium, defaultDot]) {
      expect(dot.children).toHaveLength(1);
      const svg = dot.querySelector("svg");
      expect(svg).not.toBeNull();
      for (const className of [
        "size-3",
        "fill-status-running",
        "text-status-running",
        "relative",
        "z-1",
      ]) {
        expect(svg?.classList.contains(className)).toBe(true);
      }
      expect(svg?.classList.contains("size-full")).toBe(false);
      expect(dot.querySelector(".bg-status-running")).toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("stroke-width")).toBe("2");
      const circle = svg?.querySelector("circle");
      expect(circle?.getAttribute("cx")).toBe("12");
      expect(circle?.getAttribute("cy")).toBe("12");
      expect(circle?.getAttribute("r")).toBe("10");
    }
    expect(small.querySelector("svg")).toBeNull();
    expect(small.children).toHaveLength(1);
    expect(small.firstElementChild?.classList.contains("bg-status-running")).toBe(true);
    expect(small.firstElementChild?.classList.contains("rounded-full")).toBe(true);
    expect(small.firstElementChild?.classList.contains("size-full")).toBe(true);
    for (const dot of [small, medium, defaultDot]) {
      expect(dot.getAttribute("aria-hidden")).toBe("true");
      expect(dot.classList.contains("running-status-dot")).toBe(true);
      expect(dot.hasAttribute("size")).toBe(false);
    }
  });

  test("forwards native span props and ref, merges classes, and permits an accessible label", () => {
    const ref = createRef<HTMLSpanElement>();
    const onClick = mock(() => {});
    const { getByRole } = render(
      <RunningStatusDot
        ref={ref}
        id="runtime-activity"
        title="Runtime activity"
        role="img"
        aria-label="Running"
        aria-hidden={false}
        className="size-4 shrink-0"
        onClick={onClick}
      />,
    );
    const dot = getByRole("img", { name: "Running" });

    expect(ref.current).toBe(dot);
    expect(dot.id).toBe("runtime-activity");
    expect(dot.getAttribute("title")).toBe("Runtime activity");
    expect(dot.getAttribute("aria-hidden")).toBe("false");
    expect(dot.classList.contains("running-status-dot")).toBe(true);
    expect(dot.classList.contains("shrink-0")).toBe(true);
    expect(dot.classList.contains("size-4")).toBe(true);
    expect(dot.classList.contains("size-3.5")).toBe(false);
    fireEvent.click(dot);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
