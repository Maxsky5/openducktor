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
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {},
};

const renderSection = (
  selectedRepoConfig: RepoConfig,
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void,
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
        hooks: {
          preStart: ["bun install"],
          postComplete: [],
        },
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
          hooks: {
            preStart: ["bun install"],
            postComplete: [],
          },
        }),
      ).toEqual({
        ...baseRepoConfig,
        trustedHooks: false,
        hooks: {
          preStart: [""],
          postComplete: [],
        },
      });
    } finally {
      renderer.unmount();
    }
  });
});
