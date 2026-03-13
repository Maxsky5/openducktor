import { describe, expect, mock, test } from "bun:test";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RepoSettingsInput } from "@/types/state-slices";
import { host } from "./host";
import { useRepoSettingsOperations } from "./use-repo-settings-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

type HookArgs = Parameters<typeof useRepoSettingsOperations>[0];
type HookResult = ReturnType<typeof useRepoSettingsOperations>;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useRepoSettingsOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: initialArgs }));
      });
      await flush();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as HookResult);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

const createWorkspaceRecord = (path = "/repo-a") => ({
  path,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/tmp/worktrees",
});

const inputFixture: RepoSettingsInput = {
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  codex/  ",
  defaultTargetBranch: { remote: "origin", branch: "  develop  " },
  trustedHooks: true,
  preStartHooks: ["echo pre"],
  postCompleteHooks: ["echo post"],
  worktreeFileCopies: ["  .env  ", "  .env.local  "],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: " openai ",
      modelId: " gpt-5 ",
      variant: "  mini ",
      profileId: " spec ",
    },
    planner: null,
    build: { providerId: "", modelId: "", variant: "", profileId: "" },
    qa: { providerId: "anthropic", modelId: "claude-4", variant: "", profileId: "" },
  },
};

describe("use-repo-settings-operations", () => {
  test("throws when loading without an active workspace", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const harness = createHookHarness({
      activeRepo: null,
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadRepoSettings()).rejects.toThrow(
        "Select a workspace first.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("throws when saving without an active workspace", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const harness = createHookHarness({
      activeRepo: null,
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().saveRepoSettings(inputFixture)).rejects.toThrow(
        "Select a workspace first.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("loads repo settings into normalized form values", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceGetRepoConfig = mock(
      async () =>
        ({
          defaultRuntimeKind: "opencode" as const,
          worktreeBasePath: undefined,
          branchPrefix: "codex/",
          trustedHooks: false,
          hooks: { preStart: ["a"], postComplete: ["b"] },
          agentDefaults: {
            spec: { providerId: "openai", modelId: "gpt-5" },
            planner: undefined,
            build: { providerId: "anthropic", modelId: "claude-4", variant: "v1" },
            qa: { providerId: "xai", modelId: "grok", profileId: "qa" },
          },
        }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>,
    );

    const original = {
      workspaceGetRepoConfig: host.workspaceGetRepoConfig,
    };
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      const loaded = await harness.getLatest().loadRepoSettings();

      expect(workspaceGetRepoConfig).toHaveBeenCalledWith("/repo-a");
      expect(loaded).toEqual({
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        trustedHooks: false,
        preStartHooks: ["a"],
        postCompleteHooks: ["b"],
        worktreeFileCopies: [],
        agentDefaults: {
          spec: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "",
            profileId: "",
          },
          planner: null,
          build: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-4",
            variant: "v1",
            profileId: "",
          },
          qa: {
            runtimeKind: "opencode",
            providerId: "xai",
            modelId: "grok",
            variant: "",
            profileId: "qa",
          },
        },
      });
    } finally {
      await harness.unmount();
      host.workspaceGetRepoConfig = original.workspaceGetRepoConfig;
    }
  });

  test("saveRepoSettings trims values, omits blank defaults, and updates the saved workspace", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      const specDefault = inputFixture.agentDefaults.spec;
      if (!specDefault) {
        throw new Error("Expected spec default fixture");
      }
      const input = {
        ...inputFixture,
        agentDefaults: {
          ...inputFixture.agentDefaults,
          spec: {
            ...specDefault,
            runtimeKind: "claude-code",
          },
        },
      };
      await harness.getLatest().saveRepoSettings(input);

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("/repo-a", {
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
        trustedHooks: true,
        hooks: {
          preStart: ["echo pre"],
          postComplete: ["echo post"],
        },
        worktreeFileCopies: [".env", ".env.local"],
        agentDefaults: {
          spec: {
            runtimeKind: "claude-code",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "mini",
            profileId: "spec",
          },
          qa: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-4",
          },
        },
      });
      expect(applyWorkspaceRecord).toHaveBeenCalledWith(createWorkspaceRecord());
      expect(applyWorkspaceRecords).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("supports retry after update failure and preserves refresh invariant", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    let shouldFail = true;
    const workspaceSaveRepoSettings = mock(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("write failed");
      }
      return createWorkspaceRecord();
    });

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().saveRepoSettings(inputFixture)).rejects.toThrow(
        "write failed",
      );
      expect(applyWorkspaceRecord).not.toHaveBeenCalled();

      await harness.getLatest().saveRepoSettings(inputFixture);
      expect(workspaceSaveRepoSettings).toHaveBeenCalledTimes(2);
      expect(applyWorkspaceRecord).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("loads settings snapshot through atomic IPC route", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceGetSettingsSnapshot = mock(async () => ({
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      repos: {},
      globalPromptOverrides: {},
    }));

    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual({
        git: {
          defaultMergeMethod: "merge_commit",
        },
        chat: {
          showThinkingMessages: false,
        },
        repos: {},
        globalPromptOverrides: {},
      });
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("saves settings snapshot atomically and applies returned workspaces", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveSettingsSnapshot = mock(async () => [createWorkspaceRecord()]);

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });
    const snapshot = {
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      repos: {},
      globalPromptOverrides: {},
    } as const;

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(snapshot);
      expect(applyWorkspaceRecords).toHaveBeenCalledWith([createWorkspaceRecord()]);
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
    }
  });

  test("forwards every prompt override key when saving snapshot", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    let forwardedSnapshot: unknown = null;
    const workspaceSaveSettingsSnapshot = mock(async (snapshotArg: unknown) => {
      forwardedSnapshot = snapshotArg;
      return [];
    });

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });
    const globalPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId) => [
        templateId,
        {
          template: `global ${templateId}`,
          baseVersion: 1,
          enabled: true,
        },
      ]),
    );
    const repoPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId) => [
        templateId,
        {
          template: `repo ${templateId}`,
          baseVersion: 1,
          enabled: false,
        },
      ]),
    );
    const snapshot = {
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      repos: {
        "/repo-a": {
          defaultRuntimeKind: "opencode" as const,
          worktreeBasePath: "/tmp/worktrees",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          trustedHooks: false,
          hooks: { preStart: [], postComplete: [] },
          worktreeFileCopies: [],
          promptOverrides: repoPromptOverrides,
          agentDefaults: {},
        },
      },
      globalPromptOverrides,
    };

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(snapshot);
      expect(forwardedSnapshot).toBeDefined();
      const parsedForwarded = forwardedSnapshot as {
        globalPromptOverrides: Record<string, unknown>;
        repos: Record<string, { promptOverrides: Record<string, unknown> }>;
      };
      expect(Object.keys(parsedForwarded.globalPromptOverrides).sort()).toEqual(
        [...agentPromptTemplateIdValues].sort(),
      );
      expect(Object.keys(parsedForwarded.repos["/repo-a"]?.promptOverrides ?? {}).sort()).toEqual(
        [...agentPromptTemplateIdValues].sort(),
      );
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
    }
  });

  test("saveGlobalGitConfig uses the dedicated route without mutating workspace state", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceUpdateGlobalGitConfig = mock(async () => {});

    const original = {
      workspaceUpdateGlobalGitConfig: host.workspaceUpdateGlobalGitConfig,
    };
    host.workspaceUpdateGlobalGitConfig = workspaceUpdateGlobalGitConfig;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().saveGlobalGitConfig({
        defaultMergeMethod: "squash",
      });
      expect(workspaceUpdateGlobalGitConfig).toHaveBeenCalledWith({
        defaultMergeMethod: "squash",
      });
      expect(applyWorkspaceRecords).not.toHaveBeenCalled();
      expect(applyWorkspaceRecord).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.workspaceUpdateGlobalGitConfig = original.workspaceUpdateGlobalGitConfig;
    }
  });

  test("detectGithubRepository forwards detection to the host", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceDetectGithubRepository = mock(async () => ({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    }));

    const original = {
      workspaceDetectGithubRepository: host.workspaceDetectGithubRepository,
    };
    host.workspaceDetectGithubRepository = workspaceDetectGithubRepository;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().detectGithubRepository("/repo-a")).resolves.toEqual({
        host: "github.com",
        owner: "openai",
        name: "openducktor",
      });
      expect(workspaceDetectGithubRepository).toHaveBeenCalledWith("/repo-a");
    } finally {
      await harness.unmount();
      host.workspaceDetectGithubRepository = original.workspaceDetectGithubRepository;
    }
  });
});
