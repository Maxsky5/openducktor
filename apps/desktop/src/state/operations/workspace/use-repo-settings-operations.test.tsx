import { describe, expect, mock, test } from "bun:test";
import { agentPromptTemplateIdValues, type SettingsSnapshot } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { RepoSettingsInput } from "@/types/state-slices";
import { host } from "../shared/host";
import { useRepoSettingsOperations } from "./use-repo-settings-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRepoSettingsOperations>[0];
type HookResult = ReturnType<typeof useRepoSettingsOperations>;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useRepoSettingsOperations(args);
    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(latest as HookResult);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

const createWorkspaceRecord = (path = "/repo-a") => ({
  path,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/tmp/worktrees",
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/worktrees",
});

const inputFixture: RepoSettingsInput = {
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  codex/  ",
  defaultTargetBranch: { remote: "origin", branch: "  develop  " },
  trustedHooks: true,
  preStartHooks: ["echo pre"],
  postCompleteHooks: ["echo post"],
  devServers: [{ id: "frontend", name: "Frontend", command: " bun run dev " }],
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
    qa: {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-4",
      variant: "",
      profileId: "",
    },
  },
};

describe("use-repo-settings-operations", () => {
  test("caches settings snapshot reads across repeated calls", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceGetSettingsSnapshot = mock(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
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
        theme: "light",
        git: {
          defaultMergeMethod: "merge_commit",
        },
        chat: {
          showThinkingMessages: false,
        },
        kanban: {
          doneVisibleDays: 1,
        },
        autopilot: {
          rules: [],
        },
        repos: {},
        globalPromptOverrides: {},
      });
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual({
        theme: "light",
        git: {
          defaultMergeMethod: "merge_commit",
        },
        chat: {
          showThinkingMessages: false,
        },
        kanban: {
          doneVisibleDays: 1,
        },
        autopilot: {
          rules: [],
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
          defaultTargetBranch: { remote: "origin", branch: "main" },
          trustedHooks: false,
          hooks: { preStart: ["a"], postComplete: ["b"] },
          devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
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
        devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
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
        devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
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

  test("saveRepoSettings invalidates cached settings snapshots", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());
    const workspaceGetSettingsSnapshot = mock(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
      },
      repos: {},
      globalPromptOverrides: {},
    }));

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().loadSettingsSnapshot();
      await harness.getLatest().saveRepoSettings(inputFixture);
      await harness.getLatest().loadSettingsSnapshot();

      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("saveRepoSettings preserves explicit untrusted hook settings", async () => {
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
      await harness.getLatest().saveRepoSettings({
        ...inputFixture,
        trustedHooks: false,
      });

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("/repo-a", {
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
        trustedHooks: false,
        hooks: {
          preStart: ["echo pre"],
          postComplete: ["echo post"],
        },
        devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
        worktreeFileCopies: [".env", ".env.local"],
        agentDefaults: {
          spec: {
            runtimeKind: "opencode",
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

  test("saveRepoSettings rejects blank dev server commands", async () => {
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
      await expect(
        harness.getLatest().saveRepoSettings({
          ...inputFixture,
          devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
        }),
      ).rejects.toThrow("Dev server commands cannot be blank.");
      expect(workspaceSaveRepoSettings).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("saveRepoSettings rejects configured agent defaults without runtime kind", async () => {
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
      await expect(
        harness.getLatest().saveRepoSettings({
          ...inputFixture,
          agentDefaults: {
            ...inputFixture.agentDefaults,
            spec: {
              ...(inputFixture.agentDefaults.spec ?? {
                providerId: "openai",
                modelId: "gpt-5",
                variant: "",
                profileId: "",
              }),
              runtimeKind: "   ",
            },
          },
        }),
      ).rejects.toThrow(
        "Specification agent default runtime kind is required when provider and model are configured.",
      );
      expect(workspaceSaveRepoSettings).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.workspaceSaveRepoSettings;
    }
  });

  test("loads settings snapshot through atomic IPC route", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceGetSettingsSnapshot = mock(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
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
        theme: "light",
        git: {
          defaultMergeMethod: "merge_commit",
        },
        chat: {
          showThinkingMessages: false,
        },
        kanban: {
          doneVisibleDays: 1,
        },
        autopilot: {
          rules: [],
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
    const workspaceGetSettingsSnapshot = mock(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
      },
      repos: {},
      globalPromptOverrides: {},
    }));

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });
    const snapshot: SettingsSnapshot = {
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
      },
      repos: {},
      globalPromptOverrides: {},
    };

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(snapshot);
      expect(applyWorkspaceRecords).toHaveBeenCalledWith([createWorkspaceRecord()]);
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(snapshot);
      expect(workspaceGetSettingsSnapshot).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
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
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
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
          devServers: [],
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
