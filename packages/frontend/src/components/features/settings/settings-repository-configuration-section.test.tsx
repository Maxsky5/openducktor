import { describe, expect, mock, test } from "bun:test";
import type { GitBranch, SettingsRepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";

type RepoConfigUpdater = (current: SettingsRepoConfig) => SettingsRepoConfig;

const renderSection = (overrides: Partial<SettingsRepoConfig> = {}) => {
  const updaters: RepoConfigUpdater[] = [];
  const rendered = render(
    createElement(RepositoryConfigurationSection, {
      selectedRepoConfig: { ...repoConfig, ...overrides },
      configuredWorkspaceIds: [repoConfig.workspaceId],
      selectedRepoEffectiveWorktreeBasePath: "/tmp/worktrees",
      selectedRepoBranches: [] satisfies GitBranch[],
      selectedRepoBranchesError: null,
      loadingState: {
        isLoadingSettings: false,
        isSaving: false,
        isLoadingSelectedRepoBranches: false,
      },
      onRetrySelectedRepoBranchesLoad: () => {},
      onUpdateSelectedRepoConfig: (updater: RepoConfigUpdater) => {
        updaters.push(updater);
      },
    }),
  );
  return { rendered, updaters };
};

enableReactActEnvironment();

const repoConfig: SettingsRepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: ["bun install"], postComplete: ["bun run clean"] },
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeCopyPaths: [".env"],
  promptOverrides: {},
  agentDefaults: {},
};

describe("RepositoryConfigurationSection", () => {
  test("keeps repository identity and branch fields without rendering script controls", () => {
    const updaters: Array<(current: SettingsRepoConfig) => SettingsRepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock(
      (updater: (current: SettingsRepoConfig) => SettingsRepoConfig) => {
        updaters.push(updater);
      },
    );
    const rendered = render(
      createElement(RepositoryConfigurationSection, {
        selectedRepoConfig: repoConfig,
        configuredWorkspaceIds: [repoConfig.workspaceId],
        selectedRepoEffectiveWorktreeBasePath: "/tmp/worktrees",
        selectedRepoBranches: [] satisfies GitBranch[],
        selectedRepoBranchesError: null,
        loadingState: {
          isLoadingSettings: false,
          isSaving: false,
          isLoadingSelectedRepoBranches: false,
        },
        onRetrySelectedRepoBranchesLoad: () => {},
        onUpdateSelectedRepoConfig,
      }),
    );

    try {
      const workspaceNameInput = screen.getByLabelText("Workspace name");
      fireEvent.change(workspaceNameInput, { target: { value: "Renamed Repo" } });

      expect(updaters[0]?.(repoConfig).workspaceName).toBe("Renamed Repo");
      expect(screen.getByLabelText("Repository path")).toBeTruthy();
      expect(screen.getByLabelText("Branch prefix")).toBeTruthy();
      expect(screen.queryByText("Worktree setup script (one command per line)")).toBeNull();
      expect(screen.queryByText("Dev servers")).toBeNull();
      expect(screen.queryByText("Files copied to worktrees (one path per line)")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  test("writes a typed abbreviation and shows the automatic value as the placeholder", () => {
    const { rendered, updaters } = renderSection();

    try {
      const abbreviationInput = screen.getByLabelText("Abbreviation");
      expect(abbreviationInput.getAttribute("placeholder")).toBe("RE");
      expect(abbreviationInput.getAttribute("maxlength")).toBe("3");

      fireEvent.change(abbreviationInput, { target: { value: "iOS" } });

      expect(updaters[0]?.(repoConfig).abbreviation).toBe("iOS");
    } finally {
      rendered.unmount();
    }
  });

  test("writes the picked swatch color and clears it again for the automatic choice", () => {
    const { rendered, updaters } = renderSection();

    try {
      fireEvent.click(screen.getByRole("button", { name: "Blue (#3b82f6)" }));
      expect(updaters[0]?.(repoConfig).tileColor).toBe("#3b82f6");

      fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
      expect(updaters[1]?.({ ...repoConfig, tileColor: "#3b82f6" }).tileColor).toBeUndefined();
    } finally {
      rendered.unmount();
    }
  });

  test("commits a valid hex value and keeps the previous color on a rejected one", () => {
    const { rendered, updaters } = renderSection({ tileColor: "#3b82f6" });

    try {
      const hexInput = screen.getByLabelText<HTMLInputElement>("Hex code");
      expect(hexInput.value).toBe("3b82f6");

      fireEvent.change(hexInput, { target: { value: "F08C00" } });
      expect(updaters[0]?.(repoConfig).tileColor).toBe("#f08c00");

      fireEvent.change(hexInput, { target: { value: "nothex" } });
      expect(updaters).toHaveLength(1);
      expect(screen.getByRole("alert").textContent).toContain("Enter a 6-digit RGB hex value");
    } finally {
      rendered.unmount();
    }
  });

  test("marks a selection without relying on color alone and marks nothing for an arbitrary hex", () => {
    const shadeLabels = (): string[] =>
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? "")
        .filter((label) => label.startsWith("Shade "));
    const pressedLabels = (): string[] =>
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.getAttribute("aria-label") ?? "");

    const palette = renderSection({ tileColor: "#3b82f6" });
    let shadeHex = "";
    try {
      expect(shadeLabels()).toHaveLength(5);
      expect(pressedLabels()).toEqual(["Blue (#3b82f6)"]);
      shadeHex = shadeLabels()[2]?.replace(/^Shade 3 \(|\)$/g, "") ?? "";
      expect(shadeHex).toMatch(/^#[0-9a-f]{6}$/);
    } finally {
      palette.rendered.unmount();
    }

    const shade = renderSection({ tileColor: shadeHex });
    try {
      expect(pressedLabels()).toEqual([`Shade 3 (${shadeHex})`]);
    } finally {
      shade.rendered.unmount();
    }

    const arbitrary = renderSection({ tileColor: "#123456" });
    try {
      expect(pressedLabels()).toEqual([]);
    } finally {
      arbitrary.rendered.unmount();
    }

    const automatic = renderSection();
    try {
      expect(pressedLabels()).toEqual(["Automatic"]);
    } finally {
      automatic.rendered.unmount();
    }
  });
});
