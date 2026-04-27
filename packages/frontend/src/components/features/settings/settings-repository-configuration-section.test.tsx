import { describe, expect, mock, test } from "bun:test";
import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";

enableReactActEnvironment();

const baseRepoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {},
};

const renderSection = (
  selectedRepoConfig: RepoConfig,
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void,
  options?: { showDevServerValidationErrors?: boolean },
) =>
  render(
    createElement(RepositoryConfigurationSection, {
      selectedRepoConfig,
      selectedRepoEffectiveWorktreeBasePath: null,
      selectedRepoBranches: [] as GitBranch[],
      selectedRepoBranchesError: null,
      isLoadingSettings: false,
      isSaving: false,
      isLoadingSelectedRepoBranches: false,
      onRetrySelectedRepoBranchesLoad: () => {},
      onUpdateSelectedRepoConfig,
      ...(options?.showDevServerValidationErrors !== undefined
        ? { showDevServerValidationErrors: options.showDevServerValidationErrors }
        : {}),
    }),
  );

const renderStatefulSection = (initialRepoConfig: RepoConfig) => {
  let latestRepoConfig = initialRepoConfig;

  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(initialRepoConfig);
    latestRepoConfig = selectedRepoConfig;

    return createElement(RepositoryConfigurationSection, {
      selectedRepoConfig,
      selectedRepoEffectiveWorktreeBasePath: null,
      selectedRepoBranches: [] as GitBranch[],
      selectedRepoBranchesError: null,
      isLoadingSettings: false,
      isSaving: false,
      isLoadingSelectedRepoBranches: false,
      onRetrySelectedRepoBranchesLoad: () => {},
      onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => {
        setSelectedRepoConfig((current) => updater(current));
      },
    });
  };

  const rendered = render(createElement(Wrapper));

  return {
    rendered,
    getLatestRepoConfig: () => latestRepoConfig,
  };
};

describe("RepositoryConfigurationSection", () => {
  test("renders workspace identity fields and updates workspace name", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(baseRepoConfig, onUpdateSelectedRepoConfig);

    try {
      const workspaceIdInput = screen.getByLabelText("Workspace ID");
      const workspaceNameInput = screen.getByLabelText("Workspace name");
      const repoPathInput = screen.getByLabelText("Repository path");

      if (!(workspaceIdInput instanceof HTMLInputElement)) {
        throw new Error("Expected workspace ID input");
      }
      if (!(workspaceNameInput instanceof HTMLInputElement)) {
        throw new Error("Expected workspace name input");
      }
      if (!(repoPathInput instanceof HTMLInputElement)) {
        throw new Error("Expected repository path input");
      }

      expect(workspaceIdInput.readOnly).toBe(true);
      expect(workspaceIdInput.value).toBe("repo");
      expect(repoPathInput.readOnly).toBe(true);
      expect(repoPathInput.value).toBe("/repo");

      fireEvent.change(workspaceNameInput, { target: { value: "Renamed Repo" } });

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(baseRepoConfig).workspaceName).toBe("Renamed Repo");
    } finally {
      rendered.unmount();
    }
  });

  test("preserves hook draft blank rows when editing preStart", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(baseRepoConfig);

    try {
      const preStartTextarea = rendered.container.querySelector("#repo-pre-start-hooks");
      if (!(preStartTextarea instanceof HTMLTextAreaElement)) {
        throw new Error("Expected repo pre-start hooks textarea");
      }

      fireEvent.change(preStartTextarea, {
        target: {
          value: "bun install\n",
        },
      });

      expect(preStartTextarea.value).toBe("bun install\n");
      expect(getLatestRepoConfig()).toEqual({
        ...baseRepoConfig,
        hooks: {
          preStart: ["bun install", ""],
          postComplete: [],
        },
      });
    } finally {
      rendered.unmount();
    }
  });

  test("clears empty hook rows when both fields are empty", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(
      {
        ...baseRepoConfig,
        hooks: {
          preStart: ["bun install"],
          postComplete: [],
        },
        devServers: [],
      },
      onUpdateSelectedRepoConfig,
    );

    try {
      const preStartTextarea = rendered.container.querySelector("#repo-pre-start-hooks");
      if (!(preStartTextarea instanceof HTMLTextAreaElement)) {
        throw new Error("Expected repo pre-start hooks textarea");
      }

      fireEvent.change(preStartTextarea, {
        target: {
          value: "",
        },
      });

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(
        updater({
          ...baseRepoConfig,
          hooks: {
            preStart: ["bun install"],
            postComplete: [],
          },
          devServers: [],
        }),
      ).toEqual({
        ...baseRepoConfig,
        hooks: {
          preStart: [""],
          postComplete: [],
        },
      });
    } finally {
      rendered.unmount();
    }
  });

  test("preserves worktree file copy blank rows during textarea round-trip", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(baseRepoConfig);

    try {
      const worktreeFileCopiesTextarea = rendered.container.querySelector(
        "#repo-worktree-file-copies",
      );
      if (!(worktreeFileCopiesTextarea instanceof HTMLTextAreaElement)) {
        throw new Error("Expected repo worktree file copies textarea");
      }

      fireEvent.change(worktreeFileCopiesTextarea, {
        target: {
          value: ".env\n",
        },
      });

      expect(worktreeFileCopiesTextarea.value).toBe(".env\n");
      expect(getLatestRepoConfig().worktreeFileCopies).toEqual([".env", ""]);
    } finally {
      rendered.unmount();
    }
  });

  test("updates devServers when a dev server command is entered", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(
      {
        ...baseRepoConfig,
        devServers: [{ id: "frontend", name: "Frontend", command: "" }],
      },
      onUpdateSelectedRepoConfig,
    );

    try {
      const commandInput = rendered.container.querySelector("#repo-dev-server-command-frontend");
      if (!(commandInput instanceof HTMLInputElement)) {
        throw new Error("Expected repo dev server command input");
      }

      fireEvent.change(commandInput, {
        target: {
          value: "bun run dev",
        },
      });

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(
        updater({
          ...baseRepoConfig,
          devServers: [{ id: "frontend", name: "Frontend", command: "" }],
        }),
      ).toEqual({
        ...baseRepoConfig,
        devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
      });
    } finally {
      rendered.unmount();
    }
  });

  test("shows inline validation for blank dev server fields", () => {
    const rendered = renderSection(
      {
        ...baseRepoConfig,
        devServers: [{ id: "frontend", name: "", command: "bun run dev" }],
      },
      () => {},
      { showDevServerValidationErrors: true },
    );

    try {
      const nameInput = rendered.container.querySelector("#repo-dev-server-name-frontend");
      const commandInput = rendered.container.querySelector("#repo-dev-server-command-frontend");
      const nameError = rendered.container.querySelector("#repo-dev-server-name-frontend-error");
      const commandError = rendered.container.querySelector(
        "#repo-dev-server-command-frontend-error",
      );

      if (!(nameInput instanceof HTMLInputElement) || !(commandInput instanceof HTMLInputElement)) {
        throw new Error("Expected dev server inputs");
      }
      if (!(nameError instanceof HTMLElement)) {
        throw new Error("Expected dev server inline error");
      }

      expect(nameInput.getAttribute("aria-invalid")).toBe("true");
      expect(nameInput.getAttribute("aria-describedby")).toBe(
        "repo-dev-server-name-frontend-error",
      );
      expect(commandInput.getAttribute("aria-invalid")).toBeNull();
      expect(commandInput.getAttribute("aria-describedby")).toBeNull();
      expect(nameError.textContent).toBe("Tab label is required.");
      expect(commandError).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  test("adds a dev server row with default fields", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(baseRepoConfig, onUpdateSelectedRepoConfig);
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => "00000000-0000-4000-8000-000000000002";

    try {
      const addButton = screen.getByRole("button", { name: "Add server" });
      fireEvent.click(addButton);

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(baseRepoConfig)).toEqual({
        ...baseRepoConfig,
        devServers: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            name: "Dev server 1",
            command: "",
          },
        ],
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
      rendered.unmount();
    }
  });

  test("reorders dev server rows when move handlers run", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const repoConfig = {
      ...baseRepoConfig,
      devServers: [
        { id: "frontend", name: "Frontend", command: "bun run dev" },
        { id: "backend", name: "Backend", command: "bun run api" },
      ],
    };
    const rendered = renderSection(repoConfig, onUpdateSelectedRepoConfig);

    try {
      fireEvent.click(screen.getByRole("button", { name: "Move Backend up" }));

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(repoConfig).devServers).toEqual([
        { id: "backend", name: "Backend", command: "bun run api" },
        { id: "frontend", name: "Frontend", command: "bun run dev" },
      ]);
    } finally {
      rendered.unmount();
    }
  });

  test("deletes the selected dev server row", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const repoConfig = {
      ...baseRepoConfig,
      devServers: [
        { id: "frontend", name: "Frontend", command: "bun run dev" },
        { id: "backend", name: "Backend", command: "bun run api" },
      ],
    };
    const rendered = renderSection(repoConfig, onUpdateSelectedRepoConfig);

    try {
      fireEvent.click(screen.getByRole("button", { name: "Delete Backend" }));

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(repoConfig).devServers).toEqual([
        { id: "frontend", name: "Frontend", command: "bun run dev" },
      ]);
    } finally {
      rendered.unmount();
    }
  });
});
