import { afterEach, describe, expect, mock, test } from "bun:test";
import { type AutopilotSettings, createDefaultAutopilotSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { setAutopilotRuleAction } from "@/features/autopilot/autopilot-catalog";
import { SettingsAutopilotSection } from "./settings-autopilot-section";

const renderSection = (
  autopilot: AutopilotSettings,
  disabled = false,
  loadError: string | null = null,
) => {
  let latestAutopilot = autopilot;
  const onUpdateAutopilot = mock(
    (updater: (current: AutopilotSettings) => AutopilotSettings): void => {
      latestAutopilot = updater(latestAutopilot);
    },
  );

  render(
    <SettingsAutopilotSection
      autopilot={autopilot}
      disabled={disabled}
      loadError={loadError}
      onUpdateAutopilot={onUpdateAutopilot}
    />,
  );

  return {
    getLatestAutopilot: () => latestAutopilot,
    onUpdateAutopilot,
  };
};

afterEach(() => {
  cleanup();
});

describe("settings Autopilot section", () => {
  test("shows why the saved rules could not load and how to retry", () => {
    renderSection(createDefaultAutopilotSettings(), true, "Host is busy.");

    expect(screen.getByRole("alert").textContent).toBe(
      "The saved Autopilot rules could not load: Host is busy. Close and reopen settings to try again.",
    );
  });

  test("explains host Autopilot scope, qualifying steps, and recovery limits", () => {
    renderSection(createDefaultAutopilotSettings());

    expect(
      screen.getByText(
        "Autopilot runs on the OpenDucktor host for every open workspace while the host runs. It works whichever workspace is selected, also when no browser is connected.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Runs for each QA rejection that moves a task back to In Progress. A human change request does not count.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Autopilot reacts only to task changes committed while the host runs. It does not start work for changes from before the host started. Work that has not started when the host stops is lost.",
      ),
    ).toBeDefined();
  });

  test("shows the fresh QA setting and its saved state", () => {
    const setting = {
      ...createDefaultAutopilotSettings(),
      alwaysStartQaReviewsFresh: true,
    };

    renderSection(setting);

    expect(screen.getByText("Always start QA reviews in a fresh session")).toBeDefined();
    expect(
      screen.getByText(
        "This applies only to QA reviews started by Autopilot. Each review gets a new session.",
      ),
    ).toBeDefined();
    expect(
      screen
        .getByRole("switch", { name: "Always start QA reviews in a fresh session" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("disables the fresh QA switch with the rest of the section", () => {
    renderSection(createDefaultAutopilotSettings(), true);

    expect(
      screen
        .getByRole("switch", { name: "Always start QA reviews in a fresh session" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  test("updates only the fresh QA setting when clicked", () => {
    const autopilot = createDefaultAutopilotSettings();
    const { getLatestAutopilot, onUpdateAutopilot } = renderSection(autopilot);

    fireEvent.click(
      screen.getByRole("switch", { name: "Always start QA reviews in a fresh session" }),
    );

    expect(onUpdateAutopilot).toHaveBeenCalledTimes(1);
    expect(getLatestAutopilot()).toEqual({
      ...autopilot,
      alwaysStartQaReviewsFresh: true,
    });
  });

  test("keeps the global Pull Request action available without provider support", async () => {
    renderSection(createDefaultAutopilotSettings());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "When a task progresses to Human Review" }),
      );
    });
    expect(
      screen
        .getByRole("option", { name: /Start Generate Pull Request/ })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  test("keeps a saved global Pull Request action visible", async () => {
    const autopilot = setAutopilotRuleAction(
      createDefaultAutopilotSettings(),
      "taskProgressedToHumanReview",
      "startGeneratePullRequest",
    );
    renderSection(autopilot);

    expect(
      screen.getByRole("button", { name: "When a task progresses to Human Review" }).textContent,
    ).toContain("Start Generate Pull Request");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "When a task progresses to Human Review" }),
      );
    });
    expect(
      screen
        .getByRole("option", { name: /Start Generate Pull Request/ })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });
});
