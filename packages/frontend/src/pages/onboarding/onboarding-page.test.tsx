import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createOnboardingTestHarness } from "./onboarding-page.test-support";

const { cleanup, renderOnboarding } = createOnboardingTestHarness();
afterEach(cleanup);

describe("OnboardingPage", () => {
  test("applies the chosen theme during onboarding and saves it to the host", async () => {
    const setTheme = mock(async () => undefined);

    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES, client: { setTheme } });
    const header = screen.getByRole("banner");
    const themeTrigger = within(header).getByRole("button", { name: "Theme" });
    await act(async () => {
      fireEvent.click(themeTrigger);
    });

    const darkOption = (await screen.findAllByText("Dark")).at(-1);
    if (!darkOption) {
      throw new Error("Expected the Dark theme option to be rendered");
    }
    await act(async () => {
      fireEvent.click(darkOption);
    });

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  test("announces the current onboarding step and resets scroll when it changes", async () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
    const currentStep = () =>
      within(screen.getByRole("navigation", { name: "Onboarding progress" })).getByRole(
        "listitem",
        {
          current: "step",
        },
      );
    expect(currentStep().textContent).toBe("Welcome");
    const onboardingShell = document.querySelector(".onboarding-shell");
    if (!(onboardingShell instanceof HTMLElement)) {
      throw new Error("Onboarding scroll container is missing");
    }
    onboardingShell.scrollTop = 320;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { name: "Configure coding agents" });

    expect(currentStep().textContent).toBe("Coding agents");
    expect(onboardingShell.scrollTop).toBe(0);
  });

  test.each(["successful", "InvalidStateError", "AbortError"])(
    "captures stage changes and clears animation state for %s transitions",
    async (outcome) => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(document, "startViewTransition");
      const capturedHeadings: string[] = [];
      const startViewTransition = mock((update: () => void) => {
        const heading =
          screen.queryByRole("heading", { name: "Set up your local coding workspace" }) ??
          screen.queryByRole("heading", { name: "Configure coding agents" });
        if (!heading) throw new Error("Current onboarding heading is missing");
        capturedHeadings.push(heading.textContent ?? "");
        update();
        return {
          ready:
            outcome === "successful"
              ? Promise.resolve()
              : Promise.reject(new DOMException("Transition was aborted", outcome)),
          updateCallbackDone: Promise.resolve(),
          finished: Promise.resolve(),
        };
      });
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: startViewTransition,
      });

      try {
        renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
          await Promise.resolve();
          await Promise.resolve();
        });
        await screen.findByRole("heading", { name: "Configure coding agents" });

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Back" }));
          await Promise.resolve();
        });
        await screen.findByRole("heading", { name: "Set up your local coding workspace" });

        expect(document.documentElement.classList.contains("onboarding-stage-transition")).toBe(
          false,
        );
        expect(startViewTransition).toHaveBeenCalledTimes(2);
        expect(capturedHeadings).toEqual([
          "Set up your local coding workspace",
          "Configure coding agents",
        ]);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(document, "startViewTransition", originalDescriptor);
        } else {
          Reflect.deleteProperty(document, "startViewTransition");
        }
      }
    },
  );

  test("keeps coding-agent discovery in the compact stage header", async () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const heading = await screen.findByRole("heading", { name: "Configure coding agents" });
    const headerRow = heading.parentElement;
    if (!headerRow) throw new Error("Coding-agent header row is missing");

    expect(within(headerRow).getByRole("button", { name: "Scan for coding agents" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Scan for coding agents" })).toHaveLength(1);
  });
});
