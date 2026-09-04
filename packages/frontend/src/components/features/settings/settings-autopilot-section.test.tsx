import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AutopilotSettings,
  createDefaultAutopilotSettings,
  type RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { createQueryClient } from "@/lib/query-client";
import { repositoryGitProviderContextQueryOptions } from "@/state/queries/git-provider-context";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import { SettingsAutopilotSection } from "./settings-autopilot-section";

const renderSection = (
  autopilot: AutopilotSettings,
  disabled = false,
  gitProviderContext: RepositoryGitProviderContext = createGitProviderContextFixture(),
) => {
  let latestAutopilot = autopilot;
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    repositoryGitProviderContextQueryOptions("/repo").queryKey,
    gitProviderContext,
  );
  const onUpdateAutopilot = mock(
    (updater: (current: AutopilotSettings) => AutopilotSettings): void => {
      latestAutopilot = updater(latestAutopilot);
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <SettingsAutopilotSection
        autopilot={autopilot}
        disabled={disabled}
        repoPath="/repo"
        onUpdateAutopilot={onUpdateAutopilot}
      />
    </QueryClientProvider>,
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

  test("hides Pull Request generation when the provider does not support it", async () => {
    renderSection(createDefaultAutopilotSettings(), false, null);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "When a task progresses to Human Review" }),
      );
    });
    expect(screen.queryByText("Start Generate Pull Request")).toBeNull();
  });

  test("shows but disables Pull Request generation when provider health blocks it", async () => {
    renderSection(createDefaultAutopilotSettings(), false, createGitProviderContextFixture(false));

    expect(screen.getByText(/Start Generate Pull Request.*Sign in to GitHub CLI\./)).toBeDefined();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "When a task progresses to Human Review" }),
      );
    });
    expect(
      screen
        .getByRole("option", { name: /Start Generate Pull Request/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
