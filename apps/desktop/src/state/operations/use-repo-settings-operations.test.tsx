import { describe, expect, mock, test } from "bun:test";
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

const inputFixture: RepoSettingsInput = {
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  codex/  ",
  defaultTargetBranch: "  develop  ",
  trustedHooks: true,
  preStartHooks: ["echo pre"],
  postCompleteHooks: ["echo post"],
  worktreeSetupScript: "  bun install  ",
  worktreeCleanupScript: "  rm -rf node_modules  ",
  worktreeFileCopies: ["  .env  ", "  .env.local  "],
  agentDefaults: {
    spec: {
      providerId: " openai ",
      modelId: " gpt-5 ",
      variant: "  mini ",
      opencodeAgent: " spec ",
    },
    planner: null,
    build: { providerId: "", modelId: "", variant: "", opencodeAgent: "" },
    qa: { providerId: "anthropic", modelId: "claude-4", variant: "", opencodeAgent: "" },
  },
};

describe("use-repo-settings-operations", () => {
  test("throws when loading without an active workspace", async () => {
    const refreshWorkspaces = mock(async () => {});
    const harness = createHookHarness({ activeRepo: null, refreshWorkspaces });

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
    const refreshWorkspaces = mock(async () => {});
    const harness = createHookHarness({ activeRepo: null, refreshWorkspaces });

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
    const refreshWorkspaces = mock(async () => {});
    const workspaceGetRepoConfig = mock(
      async () =>
        ({
          worktreeBasePath: undefined,
          branchPrefix: "codex/",
          trustedHooks: false,
          hooks: { preStart: ["a"], postComplete: ["b"] },
          agentDefaults: {
            spec: { providerId: "openai", modelId: "gpt-5" },
            planner: undefined,
            build: { providerId: "anthropic", modelId: "claude-4", variant: "v1" },
            qa: { providerId: "xai", modelId: "grok", opencodeAgent: "qa" },
          },
        }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>,
    );

    const original = {
      workspaceGetRepoConfig: host.workspaceGetRepoConfig,
    };
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;

    const harness = createHookHarness({ activeRepo: "/repo-a", refreshWorkspaces });

    try {
      await harness.mount();
      const loaded = await harness.getLatest().loadRepoSettings();

      expect(workspaceGetRepoConfig).toHaveBeenCalledWith("/repo-a");
      expect(loaded).toEqual({
        worktreeBasePath: "",
        branchPrefix: "codex/",
        defaultTargetBranch: "origin/main",
        trustedHooks: false,
        preStartHooks: ["a"],
        postCompleteHooks: ["b"],
        worktreeSetupScript: "",
        worktreeCleanupScript: "",
        worktreeFileCopies: [],
        agentDefaults: {
          spec: { providerId: "openai", modelId: "gpt-5", variant: "", opencodeAgent: "" },
          planner: null,
          build: {
            providerId: "anthropic",
            modelId: "claude-4",
            variant: "v1",
            opencodeAgent: "",
          },
          qa: { providerId: "xai", modelId: "grok", variant: "", opencodeAgent: "qa" },
        },
      });
    } finally {
      await harness.unmount();
      host.workspaceGetRepoConfig = original.workspaceGetRepoConfig;
    }
  });

  test("saveRepoSettings trims values, omits blank defaults, and refreshes workspaces", async () => {
    const refreshWorkspaces = mock(async () => {});
    const workspaceSaveRepoSettings = mock(async () => ({
      path: "/repo-a",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: "/tmp/worktrees",
    }));

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({ activeRepo: "/repo-a", refreshWorkspaces });

    try {
      await harness.mount();
      await harness.getLatest().saveRepoSettings(inputFixture);

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("/repo-a", {
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: "origin/develop",
        trustedHooks: true,
        hooks: {
          preStart: ["echo pre"],
          postComplete: ["echo post"],
        },
        worktreeSetupScript: "bun install",
        worktreeCleanupScript: "rm -rf node_modules",
        worktreeFileCopies: [".env", ".env.local"],
        agentDefaults: {
          spec: {
            providerId: "openai",
            modelId: "gpt-5",
            variant: "mini",
            opencodeAgent: "spec",
          },
          qa: {
            providerId: "anthropic",
            modelId: "claude-4",
          },
        },
      });
      expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("supports retry after update failure and preserves refresh invariant", async () => {
    const refreshWorkspaces = mock(async () => {});
    let shouldFail = true;
    const workspaceSaveRepoSettings = mock(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("write failed");
      }
      return {
        path: "/repo-a",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/tmp/worktrees",
      };
    });

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({ activeRepo: "/repo-a", refreshWorkspaces });

    try {
      await harness.mount();
      await expect(harness.getLatest().saveRepoSettings(inputFixture)).rejects.toThrow(
        "write failed",
      );
      expect(refreshWorkspaces).not.toHaveBeenCalled();

      await harness.getLatest().saveRepoSettings(inputFixture);
      expect(workspaceSaveRepoSettings).toHaveBeenCalledTimes(2);
      expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("loads settings snapshot through atomic IPC route", async () => {
    const refreshWorkspaces = mock(async () => {});
    const workspaceGetSettingsSnapshot = mock(async () => ({
      repos: {},
      globalPromptOverrides: {},
    }));

    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({ activeRepo: "/repo-a", refreshWorkspaces });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual({
        repos: {},
        globalPromptOverrides: {},
      });
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("saves settings snapshot atomically and refreshes workspaces once", async () => {
    const refreshWorkspaces = mock(async () => {});
    const workspaceSaveSettingsSnapshot = mock(async () => []);

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;

    const harness = createHookHarness({ activeRepo: "/repo-a", refreshWorkspaces });
    const snapshot = {
      repos: {},
      globalPromptOverrides: {},
    } as const;

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(snapshot);
      expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
    }
  });
});
