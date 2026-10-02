import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const getTooltipState = (): string | null | undefined =>
  document.querySelector('[data-slot="tooltip-content"]')?.getAttribute("data-state");

describe("TooltipProvider", () => {
  test("waits 80ms before the first tooltip and shows the next one at once", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>New terminal</TooltipTrigger>
          <TooltipContent>Open a new terminal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>Close terminal</TooltipTrigger>
          <TooltipContent>Close this terminal</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const firstTrigger = screen.getByText("New terminal");
    const hoveredAt = performance.now();
    fireEvent.pointerMove(firstTrigger, { pointerType: "mouse" });
    expect(getTooltipState()).toBeUndefined();

    await waitFor(() => expect(getTooltipState()).toBe("delayed-open"), { timeout: 500 });
    expect(performance.now() - hoveredAt).toBeGreaterThanOrEqual(75);

    fireEvent.pointerLeave(firstTrigger, { pointerType: "mouse" });
    // Leave the hover grace area that Radix keeps between the trigger and the tooltip.
    fireEvent.pointerMove(document, { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(screen.getByText("Close terminal"), { pointerType: "mouse" });

    await waitFor(() =>
      expect(screen.getAllByText("Close this terminal").length).toBeGreaterThan(0),
    );
    const nextTooltip = screen
      .getAllByText("Close this terminal")[0]
      ?.closest('[data-slot="tooltip-content"]');
    expect(nextTooltip?.getAttribute("data-state")).toBe("instant-open");
  });
});
