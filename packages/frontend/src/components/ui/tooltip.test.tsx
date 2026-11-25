import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { expect, jest, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

setupTestingLibraryFakeTimers();

test.each([
  { group: "one provider", nested: false },
  { group: "nested providers with equal settings", nested: true },
])(
  "waits 80ms for the first tooltip and opens the next one at once in $group",
  async ({ nested }) => {
    const secondTooltip = (
      <Tooltip>
        <TooltipTrigger>Close terminal</TooltipTrigger>
        <TooltipContent>Close this terminal</TooltipContent>
      </Tooltip>
    );
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>New terminal</TooltipTrigger>
          <TooltipContent>Open a new terminal</TooltipContent>
        </Tooltip>
        {nested ? <TooltipProvider>{secondTooltip}</TooltipProvider> : secondTooltip}
      </TooltipProvider>,
    );

    const firstTrigger = screen.getByRole("button", { name: "New terminal" });
    await act(async () => {
      fireEvent.pointerMove(firstTrigger, { pointerType: "mouse" });
      jest.advanceTimersByTime(79);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip").textContent).toBe("Open a new terminal");

    await act(async () => fireEvent.pointerLeave(firstTrigger, { pointerType: "mouse" }));
    // Move outside the hover area between the trigger and tooltip before entering the next one.
    await act(async () => fireEvent.pointerMove(document, { clientX: 500, clientY: 500 }));
    await act(async () =>
      fireEvent.pointerMove(screen.getByRole("button", { name: "Close terminal" }), {
        pointerType: "mouse",
      }),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Close this terminal");
  },
);
