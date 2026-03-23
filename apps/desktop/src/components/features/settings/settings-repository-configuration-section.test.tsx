import { describe, expect, mock, test } from "bun:test";
import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";

enableReactActEnvironment();

const baseRepoConfig: RepoConfig = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
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
      isPickingWorktreeBasePath: false,
      isLoadingSelectedRepoBranches: false,
      onRetrySelectedRepoBranchesLoad: () => {},
      onPickWorktreeBasePath: async () => {},
      onUpdateSelectedRepoConfig,
      ...(options?.showDevServerValidationErrors !== undefined
        ? { showDevServerValidationErrors: options.showDevServerValidationErrors }
        : {}),
    }),
  );

describe("RepositoryConfigurationSection", () => {
  test("marks scripts as trusted when a script command is entered", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(baseRepoConfig, onUpdateSelectedRepoConfig);

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

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(baseRepoConfig)).toEqual({
        ...baseRepoConfig,
        trustedHooks: true,
        hooks: {
          preStart: ["bun install", ""],
          postComplete: [],
        },
      });
    } finally {
      rendered.unmount();
    }
  });

  test("clears trust when both script fields become empty", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = renderSection(
      {
        ...baseRepoConfig,
        trustedHooks: true,
        trustedHooksFingerprint: "fingerprint",
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
          trustedHooks: true,
          trustedHooksFingerprint: "fingerprint",
          hooks: {
            preStart: ["bun install"],
            postComplete: [],
          },
          devServers: [],
        }),
      ).toEqual({
        ...baseRepoConfig,
        trustedHooks: false,
        trustedHooksFingerprint: undefined,
        hooks: {
          preStart: [""],
          postComplete: [],
        },
      });
    } finally {
      rendered.unmount();
    }
  });

  test("marks scripts as trusted when a dev server command is entered", () => {
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
        trustedHooks: true,
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
        devServers: [{ id: "frontend", name: "", command: "" }],
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
      if (!(nameError instanceof HTMLElement) || !(commandError instanceof HTMLElement)) {
        throw new Error("Expected dev server inline errors");
      }

      expect(nameInput.getAttribute("aria-invalid")).toBe("true");
      expect(nameInput.getAttribute("aria-describedby")).toBe(
        "repo-dev-server-name-frontend-error",
      );
      expect(commandInput.getAttribute("aria-invalid")).toBe("true");
      expect(commandInput.getAttribute("aria-describedby")).toBe(
        "repo-dev-server-command-frontend-error",
      );
      expect(nameError.textContent).toBe("Tab label is required.");
      expect(commandError.textContent).toBe("Command is required.");
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
