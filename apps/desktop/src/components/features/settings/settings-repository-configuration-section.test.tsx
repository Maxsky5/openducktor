import { describe, expect, mock, test } from "bun:test";
import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
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
): ReturnType<typeof create> => {
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(
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
  });

  return renderer;
};

describe("RepositoryConfigurationSection", () => {
  test("marks scripts as trusted when a script command is entered", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const renderer = renderSection(baseRepoConfig, onUpdateSelectedRepoConfig);

    try {
      const preStartTextarea = renderer.root.findByProps({ id: "repo-pre-start-hooks" });

      act(() => {
        preStartTextarea.props.onChange({
          currentTarget: {
            value: "bun install\n",
          },
        });
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
      renderer.unmount();
    }
  });

  test("clears trust when both script fields become empty", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const renderer = renderSection(
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
      const preStartTextarea = renderer.root.findByProps({ id: "repo-pre-start-hooks" });

      act(() => {
        preStartTextarea.props.onChange({
          currentTarget: {
            value: "",
          },
        });
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
      renderer.unmount();
    }
  });

  test("marks scripts as trusted when a dev server command is entered", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const renderer = renderSection(
      {
        ...baseRepoConfig,
        devServers: [{ id: "frontend", name: "Frontend", command: "" }],
      },
      onUpdateSelectedRepoConfig,
    );

    try {
      const commandInput = renderer.root.findByProps({ id: "repo-dev-server-command-frontend" });

      act(() => {
        commandInput.props.onChange({
          currentTarget: {
            value: "bun run dev",
          },
        });
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
      renderer.unmount();
    }
  });

  test("shows inline validation for blank dev server fields", () => {
    const renderer = renderSection(
      {
        ...baseRepoConfig,
        devServers: [{ id: "frontend", name: "", command: "" }],
      },
      () => {},
      { showDevServerValidationErrors: true },
    );

    try {
      const nameInput = renderer.root.findByProps({ id: "repo-dev-server-name-frontend" });
      const commandInput = renderer.root.findByProps({ id: "repo-dev-server-command-frontend" });
      const nameError = renderer.root.findByProps({ id: "repo-dev-server-name-frontend-error" });
      const commandError = renderer.root.findByProps({
        id: "repo-dev-server-command-frontend-error",
      });

      expect(nameInput.props["aria-invalid"]).toBe(true);
      expect(nameInput.props["aria-describedby"]).toBe("repo-dev-server-name-frontend-error");
      expect(commandInput.props["aria-invalid"]).toBe(true);
      expect(commandInput.props["aria-describedby"]).toBe("repo-dev-server-command-frontend-error");
      expect(nameError.props.children).toBe("Tab label is required.");
      expect(commandError.props.children).toBe("Command is required.");
    } finally {
      renderer.unmount();
    }
  });

  test("adds a dev server row with default fields", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const renderer = renderSection(baseRepoConfig, onUpdateSelectedRepoConfig);
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => "00000000-0000-4000-8000-000000000002";

    try {
      const addButton = renderer.root.findAllByType("button").find((button) => {
        const children = Array.isArray(button.props.children)
          ? button.props.children
          : [button.props.children];
        return children.includes("Add server");
      });
      if (!addButton) {
        throw new Error("Expected Add server button");
      }

      act(() => {
        addButton.props.onClick();
      });

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
      renderer.unmount();
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
    const renderer = renderSection(repoConfig, onUpdateSelectedRepoConfig);

    try {
      const moveUpButton = renderer.root.findByProps({ "aria-label": "Move Backend up" });

      act(() => {
        moveUpButton.props.onClick();
      });

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(repoConfig).devServers).toEqual([
        { id: "backend", name: "Backend", command: "bun run api" },
        { id: "frontend", name: "Frontend", command: "bun run dev" },
      ]);
    } finally {
      renderer.unmount();
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
    const renderer = renderSection(repoConfig, onUpdateSelectedRepoConfig);

    try {
      const deleteButton = renderer.root.findByProps({ "aria-label": "Delete Backend" });

      act(() => {
        deleteButton.props.onClick();
      });

      const updater = updaters[0];
      if (!updater) {
        throw new Error("Expected repo config updater");
      }

      expect(updater(repoConfig).devServers).toEqual([
        { id: "frontend", name: "Frontend", command: "bun run dev" },
      ]);
    } finally {
      renderer.unmount();
    }
  });
});
