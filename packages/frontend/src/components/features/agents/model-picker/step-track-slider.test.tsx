import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { fillStrengthFor } from "./step-track-animator";
import { centerFor, nearestEnabled, shellPath, thumbBounds, valueAt } from "./step-track-geometry";
import { StepTrackSlider, type StepTrackSliderStop } from "./step-track-slider";

enableReactActEnvironment();

const EFFORT_STOPS: readonly StepTrackSliderStop[] = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
];

const EFFORT_FILLS = [{ from: "#006aff", to: "#0059d4", tick: "#66a6ff" }] as const;

const mockSliderRect = (element: HTMLElement, width = 200): void => {
  element.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: width,
    bottom: 43,
    width,
    height: 43,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
};

describe("step-track geometry", () => {
  test("maps stop coordinates symmetrically and clamps pointer positions", () => {
    const width = 200;
    const stop0 = centerFor(0, 4, width);
    const stop3 = centerFor(3, 4, width);
    expect(stop0).toBe(14);
    expect(stop3).toBe(186);
    expect(valueAt(stop0, 4, width)).toBeCloseTo(0, 5);
    expect(valueAt(stop3, 4, width)).toBeCloseTo(3, 5);
    expect(valueAt(-50, 4, width)).toBe(0);
    expect(valueAt(500, 4, width)).toBe(3);
  });

  test("generates flat pill path at rest and morphing bump path when open", () => {
    const closed = shellPath(100, 0, 40, 200);
    const opened = shellPath(100, 1, 40, 200);
    expect(closed).not.toContain("C");
    expect(opened).toContain("C");
    expect(thumbBounds(14, 1, 200).left).toBeGreaterThanOrEqual(2);
    expect(nearestEnabled(2, [false, false, true, true])).toBe(1);
  });
});

describe("StepTrackSlider", () => {
  test("clicking between two stops snaps cleanly to the nearest stop without jumping on pointerdown", async () => {
    const onChange = mock(() => {});
    const onActiveStopChange = mock(() => {});
    render(
      <StepTrackSlider
        stops={EFFORT_STOPS}
        value="low"
        fills={EFFORT_FILLS}
        ariaLabel="Effort"
        onChange={onChange}
        onActiveStopChange={onActiveStopChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Effort" });
    mockSliderRect(slider, 200);

    // Click slightly past midpoint toward stop 2 ("high"), well off any exact stop coordinate.
    const clickX = centerFor(1.72, 4, 200);
    await act(async () => {
      fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: clickX });
    });
    // Pointerdown alone must not commit or teleport to a fractional stop.
    expect(onChange).not.toHaveBeenCalled();
    expect(onActiveStopChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.pointerUp(slider, { pointerId: 1, button: 0, clientX: clickX });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("high");
    expect(onActiveStopChange).toHaveBeenCalledWith(EFFORT_STOPS[2], 2);
  });

  test("dragging past the 4px threshold updates live preview and commits the nearest enabled stop on release", async () => {
    const onChange = mock(() => {});
    const onActiveStopChange = mock(() => {});
    const stops: StepTrackSliderStop[] = [
      { value: "standard", label: "Standard" },
      { value: "fast", label: "Fast" },
      { value: "ultrafast", label: "Ultrafast", disabled: true },
    ];
    render(
      <StepTrackSlider
        stops={stops}
        value="standard"
        fills={EFFORT_FILLS}
        ariaLabel="Speed"
        onChange={onChange}
        onActiveStopChange={onActiveStopChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Speed" });
    mockSliderRect(slider, 200);

    const startX = centerFor(0, 3, 200);
    const dragToDisabledX = centerFor(2, 3, 200);
    await act(async () => {
      fireEvent.pointerDown(slider, { pointerId: 2, button: 0, clientX: startX });
      fireEvent.pointerMove(slider, { pointerId: 2, button: 0, clientX: dragToDisabledX });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onActiveStopChange).toHaveBeenLastCalledWith(stops[2], 2);

    await act(async () => {
      fireEvent.pointerUp(slider, { pointerId: 2, button: 0, clientX: dragToDisabledX });
    });
    // Releasing over disabled "ultrafast" commits nearest enabled stop ("fast").
    expect(onChange).toHaveBeenCalledWith("fast");
  });

  test("holds optimistic stop during an async onChange without snapping back", async () => {
    let resolveSave!: () => void;
    const onChange = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <StepTrackSlider
        stops={EFFORT_STOPS}
        value="low"
        fills={EFFORT_FILLS}
        ariaLabel="Effort"
        onChange={onChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Effort" });
    await act(async () => {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    });
    expect(onChange).toHaveBeenCalledWith("medium");
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("medium");

    // Once the rejected/no-op save settles without updating value, aria-valuenow reverts cleanly.
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toBe("low");
  });

  test("keeps the label bump open at rest and fades out the fill at stop 0", () => {
    const { container, rerender } = render(
      <StepTrackSlider
        stops={EFFORT_STOPS}
        value="low"
        fills={EFFORT_FILLS}
        ariaLabel="Effort"
        onChange={() => {}}
      />,
    );

    const shell = container.querySelector("svg path");
    const fillRect = container.querySelector("svg rect");
    const label = container.querySelector<HTMLDivElement>(".step-track-label");

    expect(shell?.getAttribute("d")).toContain("C");
    expect(label?.textContent).toBe("low");
    expect(label?.style.opacity).toBe("1");
    expect(fillStrengthFor(0, 4)).toBe(0);
    expect(fillRect?.getAttribute("opacity")).toBe("0");

    rerender(
      <StepTrackSlider
        stops={EFFORT_STOPS}
        value="high"
        fills={EFFORT_FILLS}
        ariaLabel="Effort"
        onChange={() => {}}
      />,
    );

    expect(fillStrengthFor(2, 4)).toBe(1);
    expect(container.querySelector(".step-track-label")?.textContent).toBe("high");
  });
});
