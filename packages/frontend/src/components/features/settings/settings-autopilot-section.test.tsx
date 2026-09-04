import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AutopilotSettings,
  createDefaultAutopilotSettings,
  type RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { setAutopilotRuleAction } from "@/features/autopilot/autopilot-catalog";
import { QueryProvider } from "@/lib/query-provider";
import { repositoryGitProviderContextQueryOptions } from "@/state/queries/git-provider-context";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import { SettingsAutopilotSection } from "./settings-autopilot-section";

const renderSection = (
  autopilot: AutopilotSettings,
  disabled = false,
  providerResult: RepositoryGitProviderContext | Error = createGitProviderContextFixture(),
) => {
  let latestAutopilot = autopilot;
  const onUpdateAutopilot = mock(
    (updater: (current: AutopilotSettings) => AutopilotSettings): void => {
      latestAutopilot = updater(latestAutopilot);
    },
  );

  const Harness = () => {
    const queryClient = useQueryClient();
    const providerQueryOptions = repositoryGitProviderContextQueryOptions("/repo");
    if (providerResult instanceof Error) {
      queryClient.setQueryDefaults(providerQueryOptions.queryKey, { enabled: false });
      queryClient.setQueryData(providerQueryOptions.queryKey, null);
      queryClient
        .getQueryCache()
        .find({ queryKey: providerQueryOptions.queryKey })
        ?.setState({ data: undefined, error: providerResult, status: "error" });
    } else {
      queryClient.setQueryData(providerQueryOptions.queryKey, providerResult);
    }

    return (
      <SettingsAutopilotSection
        autopilot={autopilot}
        disabled={disabled}
        repoPath="/repo"
        onUpdateAutopilot={onUpdateAutopilot}
      />
    );
  };

  render(
    <QueryProvider useIsolatedClient>
      <Harness />
    </QueryProvider>,
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

  test("keeps a saved Pull Request action visible when the provider does not support it", async () => {
    const autopilot = setAutopilotRuleAction(
      createDefaultAutopilotSettings(),
      "taskProgressedToHumanReview",
      "startGeneratePullRequest",
    );
    renderSection(autopilot, false, null);

    expect(
      screen.getByRole("button", { name: "When a task progresses to Human Review" }).textContent,
    ).toContain("Start Generate Pull Request");
    expect(
      screen.getByText(/Start Generate Pull Request.*does not support Pull Requests/),
    ).toBeDefined();

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

  test("shows but disables Pull Request generation when provider health blocks it", async () => {
    renderSection(
      createDefaultAutopilotSettings(),
      false,
      createGitProviderContextFixture({ available: false }),
    );

    expect(
      screen.getAllByText(/Start Generate Pull Request.*Sign in to GitHub CLI\./),
    ).not.toHaveLength(0);
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

  test("shows but disables Pull Request generation when the provider read fails", async () => {
    renderSection(createDefaultAutopilotSettings(), false, new Error("connection failed"));

    expect(screen.getAllByText(/Start Generate Pull Request.*connection failed/)).not.toHaveLength(
      0,
    );
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
