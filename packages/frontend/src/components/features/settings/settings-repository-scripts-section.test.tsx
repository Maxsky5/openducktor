import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { RepositoryScriptsSection } from "./settings-repository-scripts-section";

enableReactActEnvironment();

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const renderStatefulSection = (
  initialRepoConfig: RepoConfig,
  options?: {
    showValidation?: boolean;
    focusRequest?: SettingsContentFocusRequest;
  },
) => {
  let latestRepoConfig = initialRepoConfig;

  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(initialRepoConfig);
    latestRepoConfig = selectedRepoConfig;
    return createElement(RepositoryScriptsSection, {
      selectedRepoConfig,
      loadingState: { isLoadingSettings: false, isSaving: false },
      validationState: { showDevServerValidationErrors: options?.showValidation ?? false },
      focusRequest: options?.focusRequest,
      onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => {
        setSelectedRepoConfig((current) => updater(current));
      },
    });
  };

  const rendered = render(createElement(Wrapper));
  return { rendered, getLatestRepoConfig: () => latestRepoConfig };
};

describe("RepositoryScriptsSection", () => {
  test("renders all repository script groups and preserves multiline draft rows", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(createRepoConfig());

    try {
      expect(screen.getByText("Worktree setup script (one command per line)")).toBeTruthy();
      expect(screen.getByText("Worktree cleanup script (one command per line)")).toBeTruthy();
      expect(screen.getByText("Dev servers")).toBeTruthy();
      expect(screen.getByText("Files copied to worktrees (one path per line)")).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Worktree setup script (one command per line)"), {
        target: { value: "bun install\n" },
      });
      fireEvent.change(screen.getByLabelText("Files copied to worktrees (one path per line)"), {
        target: { value: ".env\n" },
      });

      expect(getLatestRepoConfig().hooks.preStart).toEqual(["bun install", ""]);
      expect(getLatestRepoConfig().worktreeCopyPaths).toEqual([".env", ""]);
    } finally {
      rendered.unmount();
    }
  });

  test("adds, edits, reorders, and removes dev server rows", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection({
      ...createRepoConfig(),
      devServers: [
        { id: "frontend", name: "Frontend", command: "bun run dev" },
        { id: "backend", name: "Backend", command: "bun run api" },
      ],
    });

    try {
      fireEvent.change(
        screen.getByLabelText("Command", { selector: "#repo-dev-server-command-frontend" }),
        {
          target: { value: "bun run web" },
        },
      );
      expect(getLatestRepoConfig().devServers[0]?.command).toBe("bun run web");

      fireEvent.click(screen.getByRole("button", { name: "Move Backend up" }));
      expect(getLatestRepoConfig().devServers.map(({ id }) => id)).toEqual(["backend", "frontend"]);

      fireEvent.click(screen.getByRole("button", { name: "Delete Frontend" }));
      expect(getLatestRepoConfig().devServers.map(({ id }) => id)).toEqual(["backend"]);

      fireEvent.click(screen.getByRole("button", { name: "Add server" }));
      expect(getLatestRepoConfig().devServers.at(-1)).toEqual({
        id: "draft-dev-server-2",
        name: "Dev server 2",
        command: "",
      });
    } finally {
      rendered.unmount();
    }
  });

  test("shows existing inline validation and disables the full section while saving", () => {
    const rendered = render(
      createElement(RepositoryScriptsSection, {
        selectedRepoConfig: {
          ...createRepoConfig(),
          devServers: [{ id: "frontend", name: "", command: "bun run dev" }],
        },
        validationState: { showDevServerValidationErrors: true },
        loadingState: { isLoadingSettings: false, isSaving: true },
        onUpdateSelectedRepoConfig: () => {},
      }),
    );

    try {
      expect(screen.getByText("Tab label is required.")).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: "Add server" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (
          screen.getByLabelText(
            "Worktree setup script (one command per line)",
          ) as HTMLTextAreaElement
        ).disabled,
      ).toBe(true);
    } finally {
      rendered.unmount();
    }
  });

  test("handles one semantic focus request exactly once", () => {
    const scrollIntoView = mock(() => {});
    const onFocusRequestHandled = mock(() => {});
    const focusRequest = { kind: "repository-dev-servers" as const };
    const props = {
      selectedRepoConfig: createRepoConfig(),
      loadingState: { isLoadingSettings: false, isSaving: false },
      onFocusRequestHandled,
      onUpdateSelectedRepoConfig: () => {},
    };
    const rendered = render(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest: null,
      }),
    );
    const devServers = rendered.container.querySelector("#repository-dev-servers");
    if (!(devServers instanceof HTMLElement)) {
      throw new Error("Expected dev-server editor anchor");
    }
    devServers.scrollIntoView = scrollIntoView;

    rendered.rerender(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest,
      }),
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onFocusRequestHandled).toHaveBeenCalledWith(focusRequest);
    rendered.rerender(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest,
      }),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });
});
