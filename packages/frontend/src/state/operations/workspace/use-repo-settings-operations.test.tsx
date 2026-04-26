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
  workspaceId: path.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: path.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath: path,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/tmp/worktrees",
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/worktrees",
});

const createSettingsSnapshot = (): SettingsSnapshot => ({
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
  workspaces: {},
  globalPromptOverrides: {},
});

const createRepoConfig = () => ({
  workspaceId: "repo-a",
  workspaceName: "repo-a",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: undefined,
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: ["a"], postComplete: ["b"] },
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {
    spec: { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
    planner: undefined,
    build: {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-4",
      variant: "v1",
    },
    qa: {
      runtimeKind: "opencode" as const,
      providerId: "xai",
      modelId: "grok",
      profileId: "qa",
    },
  },
});

const inputFixture: RepoSettingsInput = {
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  codex/  ",
  defaultTargetBranch: { remote: "origin", branch: "  develop  " },
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
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());

    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(
        createSettingsSnapshot(),
      );
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(
        createSettingsSnapshot(),
      );
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
      activeWorkspace: null,
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
      activeWorkspace: null,
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
      async () => createRepoConfig() as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>,
    );

    const original = {
      workspaceGetRepoConfig: host.workspaceGetRepoConfig,
    };
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      const loaded = await harness.getLatest().loadRepoSettings();

      expect(workspaceGetRepoConfig).toHaveBeenCalledWith("repo-a");
      expect(loaded).toEqual({
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "main" },
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
      activeWorkspace: createWorkspaceRecord(),
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

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("repo-a", {
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
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
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
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

  test("saveRepoSettings sends normalized repo scripts", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().saveRepoSettings({
        ...inputFixture,
      });

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("repo-a", {
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
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
      activeWorkspace: createWorkspaceRecord(),
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

  test("saveRepoSettings omits blank dev server commands", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().saveRepoSettings({
        ...inputFixture,
        devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
      });
      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith(
        "repo-a",
        expect.objectContaining({
          devServers: [],
        }),
      );
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
      activeWorkspace: createWorkspaceRecord(),
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

  test("saveRepoSettings rejects blank repo default runtime kinds", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());

    const original = {
      workspaceSaveRepoSettings: host.workspaceSaveRepoSettings,
    };
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(
        harness.getLatest().saveRepoSettings({
          ...inputFixture,
          defaultRuntimeKind: "   " as RepoSettingsInput["defaultRuntimeKind"],
        }),
      ).rejects.toThrow(
        "Default runtime kind is required. Select a repository default runtime before saving.",
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
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());

    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(
        createSettingsSnapshot(),
      );
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("saves settings snapshot atomically and refreshes normalized snapshot from the host", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveSettingsSnapshot = mock(async () => [createWorkspaceRecord()]);
    const normalizedSnapshot: SettingsSnapshot = {
      ...createSettingsSnapshot(),
      workspaces: {
        "repo-a": {
          ...createRepoConfig(),
          repoPath: "/canonical-repo-a",
        },
      },
    };
    const workspaceGetSettingsSnapshot = mock(async () => ({
      ...normalizedSnapshot,
    }));

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });
    const snapshot: SettingsSnapshot = {
      ...createSettingsSnapshot(),
      workspaces: {
        "repo-a": {
          ...createRepoConfig(),
          repoPath: "/repo-a-link",
        },
      },
    };

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(snapshot);
      expect(applyWorkspaceRecords).toHaveBeenCalledWith([createWorkspaceRecord()]);
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(normalizedSnapshot);
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
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
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());

    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
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
      workspaces: {
        "repo-a": {
          workspaceId: "repo-a",
          workspaceName: "repo-a",
          repoPath: "/repo-a",
          defaultRuntimeKind: "opencode" as const,
          worktreeBasePath: "/tmp/worktrees",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
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
        workspaces: Record<string, { promptOverrides: Record<string, unknown> }>;
      };
      expect(Object.keys(parsedForwarded.globalPromptOverrides).sort()).toEqual(
        [...agentPromptTemplateIdValues].sort(),
      );
      expect(
        Object.keys(parsedForwarded.workspaces["repo-a"]?.promptOverrides ?? {}).sort(),
      ).toEqual([...agentPromptTemplateIdValues].sort());
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
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
      activeWorkspace: createWorkspaceRecord(),
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
      activeWorkspace: createWorkspaceRecord(),
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
