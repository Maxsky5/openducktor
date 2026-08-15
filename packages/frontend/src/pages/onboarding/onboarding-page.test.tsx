import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getAppVersion } from "@/lib/app-version";
import { hostBridge } from "@/lib/host-client";
import { createOnboardingTestHarness } from "./onboarding-page.test-support";

const { cleanup, renderOnboarding } = createOnboardingTestHarness();
afterEach(cleanup);

describe("OnboardingPage", () => {
  test("renders a horizontal progress indicator above the current stage", () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });

    const progress = screen.getByRole("navigation", { name: "Onboarding progress" });
    const currentStepLabel = within(progress).getByText("Welcome");
    expect(progress.getAttribute("data-orientation")).toBe("horizontal");
    expect(progress.querySelectorAll("[data-progress-connector]")).toHaveLength(2);
    expect(within(progress).getByText("Coding agents")).toBeTruthy();
    expect(currentStepLabel.className).toContain("text-foreground");
    expect(currentStepLabel.className).not.toContain("text-primary");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("keeps the Welcome stage focused on the setup task", () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });

    expect(
      screen.getByRole("heading", { name: "Set up your local coding workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OpenDucktor works with a local Git repository and guides each change through Spec, Plan, Build, and QA.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configure coding agents" })).toBeTruthy();
    expect(screen.queryByText("Welcome to OpenDucktor")).toBeNull();
    expect(screen.queryByText("First-time setup")).toBeNull();
    expect(screen.queryByText("Move from idea to reviewed change.")).toBeNull();
    expect(screen.queryByText("Define the outcome")).toBeNull();
  });

  test("shows the app version and theme control in the onboarding header", async () => {
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = mock(async () => undefined);

    try {
      renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
      const header = screen.getByRole("banner");
      const appVersion = getAppVersion();

      expect(within(header).queryByText("Local delivery workspace")).toBeNull();
      if (appVersion) expect(within(header).getByText(appVersion)).toBeTruthy();

      const themeSwitch = within(header).getByRole("switch", { name: "Toggle dark mode" });
      fireEvent.click(themeSwitch);

      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
      expect(themeSwitch.getAttribute("aria-checked")).toBe("true");
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("resets the onboarding scroll position when the stage changes", async () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
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

    expect(onboardingShell.scrollTop).toBe(0);
  });

  test("captures the current stage before replacing it with the next stage", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "startViewTransition");
    const capturedHeadings: string[] = [];
    const startViewTransition = mock((update: () => void) => {
      const heading =
        screen.queryByRole("heading", { name: "Set up your local coding workspace" }) ??
        screen.queryByRole("heading", { name: "Configure coding agents" });
      if (!heading) throw new Error("Current onboarding heading is missing");
      capturedHeadings.push(heading.textContent ?? "");
      update();
      return { finished: Promise.resolve() };
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
  });

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
