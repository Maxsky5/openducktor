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
      const textNodes = renderer.root.findAll(
        (node) => typeof node.props.children === "string" && node.props.children.length > 0,
      );
      const textContent = textNodes.map((node) => node.props.children as string).join(" ");

      expect(nameInput.props["aria-invalid"]).toBe(true);
      expect(commandInput.props["aria-invalid"]).toBe(true);
      expect(textContent).toContain("Tab label is required.");
      expect(textContent).toContain("Command is required.");
    } finally {
      renderer.unmount();
    }
  });
});
