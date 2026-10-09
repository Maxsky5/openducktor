import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  agentPromptTemplateIdValues,
  DEFAULT_AGENT_RUNTIMES,
  type RepositoryGitProviderContext,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  type SettingsSnapshotSaveResult,
  type RepoActions,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { type QueryClient, QueryObserver, useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createDeferred,
  createGitProviderConfigFixture,
  createGitProviderContextFixture,
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { RepoSettingsInput } from "@/types/state-slices";
import { checksQueryKeys } from "../../queries/checks";
import { repositoryGitProviderContextQueryKeys } from "../../queries/git-provider-context";
import { runtimeQueryKeys } from "../../queries/runtime";
import { repoTaskDataQueryOptions, type RepoTaskData, taskQueryKeys } from "../../queries/tasks";
import {
  repoConfigQueryOptions,
  settingsSnapshotQueryOptions,
  workspaceQueryKeys,
} from "../../queries/workspace";
import { customAgentRolesQueryOptions } from "../../queries/workspace-sessions";
import { host } from "../shared/host";
import { useRepoSettingsOperations } from "./use-repo-settings-operations";

const savedResult = (workspaces: WorkspaceRecord[]): SettingsSnapshotSaveResult => ({
  type: "saved",
  workspaces,
  runtimeApplications: [],
});

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRepoSettingsOperations>[0];
type HookResult = ReturnType<typeof useRepoSettingsOperations>;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;
  let queryClient: QueryClient | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useRepoSettingsOperations(args);
    return null;
  };

  const CaptureQueryClient = () => {
    queryClient = useQueryClient();
    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <IsolatedQueryWrapper>
      <CaptureQueryClient />
      {children}
    </IsolatedQueryWrapper>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      const hook = latest;
      if (!hook) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(hook);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    getQueryClient: () => {
      if (!queryClient) {
        throw new Error("Query client not mounted");
      }
      return queryClient;
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

const createWorkspaceRecord = (path = "/repo-a") => ({
  workspaceId: path.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: path.split("/").filter(Boolean).at(-1) ?? "repo",
  abbreviation: null,
  tileColor: null,
  repoPath: path,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/tmp/worktrees",
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/worktrees",
});

const createSettingsSnapshot = (): SettingsSnapshot => createSettingsSnapshotFixture();

const isRepositoryGitProviderContextRepoFilter = (
  filters: { queryKey?: unknown } | undefined,
  repoPath: string,
): boolean =>
  Array.isArray(filters?.queryKey) &&
  filters.queryKey[0] === repositoryGitProviderContextQueryKeys.all[0] &&
  filters.queryKey[1] === repoPath;

const startSettingsSave = async ({
  previousSnapshot,
  normalizedSnapshot,
  gateProviderRefreshRepoPath,
  seedProviderContextRepoPaths,
  saveError,
}: {
  previousSnapshot: SettingsSnapshot;
  normalizedSnapshot: SettingsSnapshot;
  gateProviderRefreshRepoPath?: string;
  seedProviderContextRepoPaths?: string[];
  saveError?: Error;
}) => {
  const original = {
    workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
    workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
  };
  host.workspaceSaveSettingsSnapshot = mock(async () => {
    if (saveError !== undefined) {
      throw saveError;
    }
    return savedResult([createWorkspaceRecord()]);
  });
  host.workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
  const applyWorkspaceRecords = mock(() => {});
  const harness = createHookHarness({
    activeWorkspace: createWorkspaceRecord(),
    applyWorkspaceRecords,
    applyWorkspaceRecord: mock(() => {}),
  });
  const providerRefresh = createDeferred<void>();
  const providerRefreshStarted = createDeferred<void>();

  await harness.mount();
  const queryClient = harness.getQueryClient();
  const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
  const invalidateQueries = spyOn(queryClient, "invalidateQueries").mockImplementation(
    async (filters, options) => {
      await originalInvalidateQueries(filters, options);
    },
  );
  const originalResetQueries = queryClient.resetQueries.bind(queryClient);
  const resetQueries = spyOn(queryClient, "resetQueries").mockImplementation(
    async (filters, options) => {
      if (
        gateProviderRefreshRepoPath !== undefined &&
        isRepositoryGitProviderContextRepoFilter(filters, gateProviderRefreshRepoPath)
      ) {
        providerRefreshStarted.resolve();
        await providerRefresh.promise;
        return;
      }
      await originalResetQueries(filters, options);
    },
  );
  queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), previousSnapshot);
  for (const repoPath of seedProviderContextRepoPaths ?? []) {
    queryClient.setQueryData(
      repositoryGitProviderContextQueryKeys.repo(repoPath),
      createGitProviderContextFixture(),
    );
  }

  return {
    queryClient,
    invalidateQueries,
    resetQueries,
    applyWorkspaceRecords,
    save: harness.getLatest().saveSettingsSnapshot(normalizedSnapshot),
    providerRefreshStarted,
    cleanup: async (): Promise<void> => {
      providerRefresh.resolve();
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    },
  };
};

const createRepoActions = (): RepoActions => ({
  items: [
    {
      id: "test",
      icon: "test",
      name: "Test",
      command: "bun test",
      runOnWorktreeCreate: true,
      waitBeforeAgentStart: true,
    },
  ],
  defaultActionId: "test",
});

const createRepoConfig = (): Awaited<ReturnType<typeof host.workspaceGetRepoConfig>> => ({
  workspaceId: "repo-a",
  workspaceName: "repo-a",
  repoPath: "/repo-a",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: ["b"] },
  actions: createRepoActions(),
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {
    spec: { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
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
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  codex/  ",
  defaultModel: null,
  defaultTargetBranch: { remote: "origin", branch: "  develop  " },
  postCompleteHooks: ["echo post"],
  actions: createRepoActions(),
  worktreeCopyPaths: ["  .env  ", "  .env.local  "],
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

  test("saves agent model favorites and replaces the cached snapshot with the host result", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const initialSnapshot = createSettingsSnapshot();
    const favorites = [
      { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
    ];
    const canonicalSnapshot = { ...initialSnapshot, agentModelFavorites: favorites };
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateAgentModelFavorites = mock(async () => canonicalSnapshot);
    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
      workspaceUpdateAgentModelFavorites: host.workspaceUpdateAgentModelFavorites,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    host.workspaceUpdateAgentModelFavorites = workspaceUpdateAgentModelFavorites;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().loadSettingsSnapshot();
      await expect(harness.getLatest().saveAgentModelFavorites(favorites)).resolves.toEqual(
        canonicalSnapshot,
      );
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(canonicalSnapshot);
      expect(workspaceUpdateAgentModelFavorites).toHaveBeenCalledWith(favorites);
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
      host.workspaceUpdateAgentModelFavorites = original.workspaceUpdateAgentModelFavorites;
    }
  });

  test("keeps the last cached favorites when the host write fails", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const initialSnapshot = createSettingsSnapshotFixture({
      agentModelFavorites: [
        { runtimeKind: "claude", providerId: "anthropic", modelId: "claude-opus" },
      ],
    });
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateAgentModelFavorites = mock(async () => {
      throw new Error("Could not save favorites");
    });
    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
      workspaceUpdateAgentModelFavorites: host.workspaceUpdateAgentModelFavorites,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    host.workspaceUpdateAgentModelFavorites = workspaceUpdateAgentModelFavorites;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().loadSettingsSnapshot();
      await expect(
        harness
          .getLatest()
          .saveAgentModelFavorites([
            { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
          ]),
      ).rejects.toThrow("Could not save favorites");
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(initialSnapshot);
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
      host.workspaceUpdateAgentModelFavorites = original.workspaceUpdateAgentModelFavorites;
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
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());

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
        worktreeBasePath: "",
        branchPrefix: "codex/",
        defaultModel: null,
        defaultTargetBranch: { remote: "origin", branch: "main" },
        postCompleteHooks: ["b"],
        actions: createRepoActions(),
        worktreeCopyPaths: [],
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
      const input: RepoSettingsInput = {
        ...inputFixture,
        agentDefaults: {
          ...inputFixture.agentDefaults,
          spec: {
            ...specDefault,
            runtimeKind: "opencode",
          },
        },
      };
      await harness.getLatest().saveRepoSettings(input);

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("repo-a", {
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
        hooks: {
          postComplete: ["echo post"],
        },
        actions: createRepoActions(),
        worktreeCopyPaths: [".env", ".env.local"],
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

  test("saveRepoSettings refreshes a mounted repository config", async () => {
    const savedConfig = createRepoConfig();
    const original = {
      save: host.workspaceSaveRepoSettings,
      getRepoConfig: host.workspaceGetRepoConfig,
    };
    host.workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord());
    host.workspaceGetRepoConfig = mock(async () => savedConfig);
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: mock(() => {}),
      applyWorkspaceRecord: mock(() => {}),
    });
    const options = repoConfigQueryOptions("repo-a");
    let unsubscribe = () => {};

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(options.queryKey, {
        ...savedConfig,
        actions: { items: [], defaultActionId: null },
      });
      const observer = new QueryObserver(queryClient, options);
      unsubscribe = observer.subscribe(() => {});
      expect(observer.getCurrentResult().data?.actions.items).toEqual([]);

      await harness.run((operations) => operations.saveRepoSettings(inputFixture));

      expect(observer.getCurrentResult().data?.actions).toEqual(createRepoActions());
      expect(host.workspaceGetRepoConfig).toHaveBeenCalledWith("repo-a");
    } finally {
      unsubscribe();
      await harness.unmount();
      host.workspaceSaveRepoSettings = original.save;
      host.workspaceGetRepoConfig = original.getRepoConfig;
    }
  });

  test("saves only chosen model defaults for a newly created workspace", async () => {
    const workspaceSaveRepoSettings = mock(async () => createWorkspaceRecord("/new-repo"));
    const original = host.workspaceSaveRepoSettings;
    host.workspaceSaveRepoSettings = workspaceSaveRepoSettings;
    const applyWorkspaceRecord = mock(() => {});
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await harness.getLatest().saveWorkspaceModelDefaults("new-repo", {
        defaultModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "o3",
          variant: "high",
        },
        agentDefaults: {
          qa: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude",
          },
        },
      });
      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("new-repo", {
        defaultModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "o3",
          variant: "high",
        },
        agentDefaults: {
          qa: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude",
          },
        },
      });
      expect(applyWorkspaceRecord).toHaveBeenCalledWith(createWorkspaceRecord("/new-repo"));
      await expect(
        harness.getLatest().saveWorkspaceModelDefaults("new-repo", {
          agentDefaults: { spec: { runtimeKind: "codex", providerId: "", modelId: "o3" } },
        }),
      ).rejects.toThrow("spec default needs a runtime and model");
      expect(workspaceSaveRepoSettings).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.workspaceSaveRepoSettings = original;
    }
  });

  test("saveRepoSettings sends normalized cleanup hooks and the repository actions", async () => {
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
        postCompleteHooks: ["\t", " echo post "],
      });

      expect(workspaceSaveRepoSettings).toHaveBeenCalledWith("repo-a", {
        worktreeBasePath: "/tmp/worktrees",
        branchPrefix: "codex/",
        defaultTargetBranch: { remote: "origin", branch: "develop" },
        hooks: {
          postComplete: ["echo post"],
        },
        actions: createRepoActions(),
        worktreeCopyPaths: [".env", ".env.local"],
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
              providerId: "openai",
              modelId: "gpt-5",
              variant: "",
              profileId: "",
            } satisfies NonNullable<RepoSettingsInput["agentDefaults"]["spec"]>,
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

  test.each([
    {
      name: "publishes a full-save preference change to mounted settings observers",
      save: (operations: HookResult, snapshot: SettingsSnapshot) =>
        operations.saveSettingsSnapshot(snapshot),
    },
    {
      name: "keeps settings observers attached after a Git-only save",
      save: (operations: HookResult, snapshot: SettingsSnapshot) =>
        operations.saveGlobalGitConfig(snapshot.git),
    },
  ])("$name", async ({ save }) => {
    const initial = createSettingsSnapshot();
    const saved = { ...initial, system: { preferredOpenInToolId: "zed" as const } };
    const original = {
      get: host.workspaceGetSettingsSnapshot,
      save: host.workspaceSaveSettingsSnapshot,
      saveGit: host.workspaceUpdateGlobalGitConfig,
    };
    host.workspaceGetSettingsSnapshot = async () => saved;
    host.workspaceSaveSettingsSnapshot = async () => savedResult([]);
    host.workspaceUpdateGlobalGitConfig = async () => {};
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
      applyWorkspaceRecord: () => {},
    });
    let unsubscribe = () => {};
    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), initial);
      const observer = new QueryObserver(queryClient, settingsSnapshotQueryOptions());
      let observed = initial;
      unsubscribe = observer.subscribe((result) => {
        if (result.data) observed = result.data;
      });
      await harness.run(async (operations) => {
        await save(operations, saved);
      });
      expect(observed.system).toEqual(saved.system);
    } finally {
      unsubscribe();
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.get;
      host.workspaceSaveSettingsSnapshot = original.save;
      host.workspaceUpdateGlobalGitConfig = original.saveGit;
    }
  });

  test("saves settings snapshot atomically and refreshes normalized snapshot from the host", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveSettingsSnapshot = mock(async (_snapshot: SettingsSnapshotSaveInput) =>
      savedResult([createWorkspaceRecord()]),
    );
    const explicitChatSettings = {
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
      diffStyle: "unified" as const,
      diffIndicators: "classic" as const,
      diffHeight: "scroll" as const,
      lineOverflow: "scroll" as const,
      hunkSeparators: "metadata" as const,
    };
    const normalizedSnapshot: SettingsSnapshot = {
      ...createSettingsSnapshot(),
      kanban: {
        ...createSettingsSnapshot().kanban,
        doneVisibleDays: 7,
      },
      chat: explicitChatSettings,
      autopilot: {
        ...createSettingsSnapshot().autopilot,
        alwaysStartQaReviewsFresh: true,
      },
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
    const tasksList = mock(async () => []);

    const original = {
      tasksList: host.tasksList,
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.tasksList = tasksList;
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });
    const snapshot: SettingsSnapshot = {
      ...createSettingsSnapshot(),
      kanban: {
        ...createSettingsSnapshot().kanban,
        doneVisibleDays: 7,
      },
      chat: explicitChatSettings,
      autopilot: {
        ...createSettingsSnapshot().autopilot,
        alwaysStartQaReviewsFresh: true,
      },
      workspaces: {
        "repo-a": {
          ...createRepoConfig(),
          repoPath: "/repo-a-link",
        },
      },
    };

    try {
      await harness.mount();
      harness
        .getQueryClient()
        .setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      harness.getQueryClient().setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [] });
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith({ ...snapshot }, undefined);
      expect(workspaceSaveSettingsSnapshot.mock.calls[0]?.[0]?.chat).toEqual(explicitChatSettings);
      expect(
        workspaceSaveSettingsSnapshot.mock.calls[0]?.[0]?.autopilot.alwaysStartQaReviewsFresh,
      ).toBe(true);
      expect(applyWorkspaceRecords).toHaveBeenCalledWith([createWorkspaceRecord()]);
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(normalizedSnapshot);
      expect(
        harness
          .getQueryClient()
          .getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.autopilot
          .alwaysStartQaReviewsFresh,
      ).toBe(true);
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(tasksList).toHaveBeenCalledWith("/repo-a");
      expect(
        harness.getQueryClient().getQueryState(taskQueryKeys.repoData("/repo-a")),
      ).toMatchObject({
        isInvalidated: false,
        status: "success",
      });
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("replaces an in-flight task read after the retention setting changes", async () => {
    const firstTaskRead = createDeferred<Awaited<ReturnType<typeof host.tasksList>>>();
    const firstTaskReadStarted = createDeferred<void>();
    const refreshedTasks = [createTaskCardFixture({ title: "New retention" })];
    const tasksList = mock(async () => {
      if (tasksList.mock.calls.length === 1) {
        firstTaskReadStarted.resolve();
        return firstTaskRead.promise;
      }
      return refreshedTasks;
    });
    const normalizedSnapshot = createSettingsSnapshotFixture({ kanban: { doneVisibleDays: 7 } });
    const workspaceSaveSettingsSnapshot = mock(async () => savedResult([createWorkspaceRecord()]));
    const workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
    const original = {
      tasksList: host.tasksList,
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.tasksList = tasksList;
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: mock(() => {}),
      applyWorkspaceRecord: mock(() => {}),
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: [] });
      const pendingTaskRead = queryClient.fetchQuery(repoTaskDataQueryOptions("/repo-a"));
      void pendingTaskRead.catch(() => {});
      await firstTaskReadStarted.promise;

      await harness.getLatest().saveSettingsSnapshot(normalizedSnapshot);

      expect(tasksList).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-a"))).toEqual({
        tasks: refreshedTasks,
      });
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-b"))?.isInvalidated).toBe(
        true,
      );

      firstTaskRead.resolve([createTaskCardFixture({ title: "Old retention" })]);
      await Promise.allSettled([pendingTaskRead]);
      expect(queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-a"))).toEqual({
        tasks: refreshedTasks,
      });
    } finally {
      firstTaskRead.resolve([createTaskCardFixture({ title: "Old retention" })]);
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("keeps a committed settings save successful when the task refresh fails", async () => {
    const taskRefreshFailure = new Error("task refresh failed");
    const normalizedSnapshot = createSettingsSnapshotFixture({ kanban: { doneVisibleDays: 7 } });
    const workspaceSaveSettingsSnapshot = mock(async () => savedResult([createWorkspaceRecord()]));
    const workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
    const tasksList = mock(async () => {
      throw taskRefreshFailure;
    });
    const original = {
      tasksList: host.tasksList,
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.tasksList = tasksList;
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: mock(() => {}),
      applyWorkspaceRecord: mock(() => {}),
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [] });

      await expect(
        harness.getLatest().saveSettingsSnapshot(normalizedSnapshot),
      ).resolves.toMatchObject({ type: "saved" });

      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.kanban
          .doneVisibleDays,
      ).toBe(7);
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-a"))).toMatchObject({
        error: taskRefreshFailure,
        status: "error",
      });
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("keeps the committed save and runtime results when the settings reload fails", async () => {
    const workspaces = [createWorkspaceRecord()];
    const workspaceSaveSettingsSnapshot = mock(async (): Promise<SettingsSnapshotSaveResult> => ({
      type: "saved",
      workspaces,
      runtimeApplications: [
        { kind: "opencode", effect: "replace", outcome: "failed", message: "missing binary" },
      ],
    }));
    const workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("settings read failed");
    });
    const applyWorkspaceRecords = mock(() => {});
    const original = {
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord: mock(() => {}),
    });

    try {
      await harness.mount();
      const outcome = await harness.getLatest().saveSettingsSnapshot(createSettingsSnapshot());

      expect(outcome).toMatchObject({
        type: "saved",
        refreshError: "settings read failed",
        runtimeApplications: [{ kind: "opencode", outcome: "failed" }],
      });
      expect(applyWorkspaceRecords).toHaveBeenCalledWith(workspaces);
      expect(
        harness.getQueryClient().getQueryData<WorkspaceRecord[]>(workspaceQueryKeys.list()),
      ).toEqual(workspaces);
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("refreshes the rebound active repository after retention settings change", async () => {
    const taskRefreshFailure = new Error("task refresh failed");
    const reboundWorkspace = {
      ...createWorkspaceRecord("/repo-b"),
      workspaceId: "repo-a",
      workspaceName: "repo-a",
    };
    const normalizedSnapshot = createSettingsSnapshotFixture({
      kanban: { doneVisibleDays: 7 },
      workspaces: {
        "repo-a": {
          ...createRepoConfig(),
          repoPath: reboundWorkspace.repoPath,
        },
      },
    });
    const workspaceSaveSettingsSnapshot = mock(async () => savedResult([reboundWorkspace]));
    const workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
    const tasksList = mock(async () => {
      throw taskRefreshFailure;
    });
    const original = {
      tasksList: host.tasksList,
      workspaceSaveSettingsSnapshot: host.workspaceSaveSettingsSnapshot,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.tasksList = tasksList;
    host.workspaceSaveSettingsSnapshot = workspaceSaveSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: mock(() => {}),
      applyWorkspaceRecord: mock(() => {}),
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [] });

      await expect(
        harness.getLatest().saveSettingsSnapshot(normalizedSnapshot),
      ).resolves.toMatchObject({ type: "saved" });

      expect(tasksList).toHaveBeenCalledTimes(1);
      expect(tasksList).toHaveBeenCalledWith("/repo-b");
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-b"))).toMatchObject({
        error: taskRefreshFailure,
        status: "error",
      });
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("skips invalidations when the saved settings change nothing watched", async () => {
    const snapshot = createSettingsSnapshotFixture({
      workspaces: { "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") },
    });
    const run = await startSettingsSave({
      previousSnapshot: snapshot,
      normalizedSnapshot: snapshot,
    });

    try {
      await run.save;

      expect(run.invalidateQueries).not.toHaveBeenCalled();
      expect(run.resetQueries).not.toHaveBeenCalled();
      expect(run.applyWorkspaceRecords).toHaveBeenCalledTimes(1);
    } finally {
      await run.cleanup();
    }
  });

  test("invalidates only the role catalog when custom roles change", async () => {
    const run = await startSettingsSave({
      previousSnapshot: createSettingsSnapshotFixture(),
      normalizedSnapshot: createSettingsSnapshotFixture({
        customAgentRoles: [{ id: "reviewer", name: "Reviewer", systemPrompt: "Review the code." }],
      }),
    });

    try {
      await run.save;
      expect(run.invalidateQueries.mock.calls).toEqual([
        [{ queryKey: customAgentRolesQueryOptions().queryKey }],
      ]);
      expect(run.resetQueries).not.toHaveBeenCalled();
    } finally {
      await run.cleanup();
    }
  });

  test("invalidates repository config when a non-git workspace setting changed", async () => {
    const previousSnapshot = createSettingsSnapshotFixture({
      workspaces: { "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") },
    });
    const normalizedSnapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-a": {
          ...createRepoSettingsConfigFixture("repo-a", "/repo-a"),
          hooks: { postComplete: ["bun run cleanup"] },
        },
      },
    });
    const run = await startSettingsSave({ previousSnapshot, normalizedSnapshot });

    try {
      await run.save;

      expect(run.invalidateQueries).toHaveBeenCalledWith({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
      });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: checksQueryKeys.all });
      expect(run.resetQueries).not.toHaveBeenCalled();
    } finally {
      await run.cleanup();
    }
  });

  test("adding an action refreshes the mounted repository config", async () => {
    const previousRepoA = createRepoSettingsConfigFixture("repo-a", "/repo-a");
    const previousSnapshot = createSettingsSnapshotFixture({
      workspaces: { "repo-a": previousRepoA },
    });
    const normalizedSnapshot = createSettingsSnapshotFixture({
      workspaces: { "repo-a": { ...previousRepoA, actions: createRepoActions() } },
    });
    const savedConfig = createRepoConfig();
    const original = {
      getRepoConfig: host.workspaceGetRepoConfig,
      save: host.workspaceSaveSettingsSnapshot,
      getSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceGetRepoConfig = mock(async () => savedConfig);
    host.workspaceSaveSettingsSnapshot = mock(async () => savedResult([createWorkspaceRecord()]));
    host.workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: mock(() => {}),
      applyWorkspaceRecord: mock(() => {}),
    });
    const options = repoConfigQueryOptions("repo-a");
    let unsubscribe = () => {};

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), previousSnapshot);
      queryClient.setQueryData(options.queryKey, {
        ...savedConfig,
        actions: { items: [], defaultActionId: null },
      });
      const observer = new QueryObserver(queryClient, options);
      unsubscribe = observer.subscribe(() => {});
      expect(observer.getCurrentResult().data?.actions.items).toEqual([]);

      await harness.run(async (operations) => {
        await operations.saveSettingsSnapshot(normalizedSnapshot);
      });

      expect(observer.getCurrentResult().data?.actions).toEqual(createRepoActions());
      expect(host.workspaceGetRepoConfig).toHaveBeenCalledWith("repo-a");
    } finally {
      unsubscribe();
      await harness.unmount();
      host.workspaceGetRepoConfig = original.getRepoConfig;
      host.workspaceSaveSettingsSnapshot = original.save;
      host.workspaceGetSettingsSnapshot = original.getSnapshot;
    }
  });

  test("invalidates only the repository whose git provider config changed", async () => {
    const previousSnapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "repo-b" }),
        ),
      },
    });
    const normalizedSnapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "renamed" }),
        ),
      },
    });
    const run = await startSettingsSave({
      previousSnapshot,
      normalizedSnapshot,
      seedProviderContextRepoPaths: ["/repo-a", "/repo-b"],
    });

    try {
      await run.save;

      expect(run.resetQueries).toHaveBeenCalledWith({
        queryKey: repositoryGitProviderContextQueryKeys.repo("/repo-b"),
      });
      expect(run.resetQueries).not.toHaveBeenCalledWith({
        queryKey: repositoryGitProviderContextQueryKeys.repo("/repo-a"),
      });
      expect(run.invalidateQueries).toHaveBeenCalledWith({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
      });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: checksQueryKeys.all });
      expect(
        run.queryClient.getQueryData(repositoryGitProviderContextQueryKeys.repo("/repo-b")),
      ).toBeUndefined();
      expect(
        run.queryClient.getQueryData<RepositoryGitProviderContext>(
          repositoryGitProviderContextQueryKeys.repo("/repo-a"),
        ),
      ).toEqual(createGitProviderContextFixture());
    } finally {
      await run.cleanup();
    }
  });

  test("invalidates runtime checks when the save changes agent runtimes", async () => {
    const nextRuntimes = structuredClone(DEFAULT_AGENT_RUNTIMES);
    nextRuntimes.codex.enabled = true;
    const run = await startSettingsSave({
      previousSnapshot: createSettingsSnapshot(),
      normalizedSnapshot: createSettingsSnapshotFixture({ agentRuntimes: nextRuntimes }),
    });

    try {
      await run.save;

      expect(run.invalidateQueries).toHaveBeenCalledWith({ queryKey: checksQueryKeys.all });
      expect(run.invalidateQueries).toHaveBeenCalledWith({
        queryKey: runtimeQueryKeys.definitions(),
      });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: runtimeQueryKeys.all });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
      });
      expect(run.resetQueries).not.toHaveBeenCalled();
    } finally {
      await run.cleanup();
    }
  });

  test("does not wait for the changed repository provider refresh before resolving", async () => {
    const previousSnapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "repo-b" }),
        ),
      },
    });
    const normalizedSnapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "renamed" }),
        ),
      },
    });
    const run = await startSettingsSave({
      previousSnapshot,
      normalizedSnapshot,
      gateProviderRefreshRepoPath: "/repo-b",
    });

    try {
      await run.providerRefreshStarted.promise;
      await run.save;

      expect(run.resetQueries).toHaveBeenCalledWith({
        queryKey: repositoryGitProviderContextQueryKeys.repo("/repo-b"),
      });
    } finally {
      await run.cleanup();
    }
  });

  test("propagates a host save failure without touching the cache", async () => {
    const snapshot = createSettingsSnapshotFixture({
      workspaces: { "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") },
    });
    const run = await startSettingsSave({
      previousSnapshot: snapshot,
      normalizedSnapshot: snapshot,
      saveError: new Error("host save failed"),
    });

    try {
      await expect(run.save).rejects.toThrow("host save failed");

      expect(
        run.queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot()),
      ).toBe(snapshot);
      expect(run.invalidateQueries).not.toHaveBeenCalled();
      expect(run.resetQueries).not.toHaveBeenCalled();
    } finally {
      await run.cleanup();
    }
  });

  test("forwards every prompt override key when saving snapshot", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceSaveSettingsSnapshot = mock(
      async (_snapshotArg: Parameters<typeof host.workspaceSaveSettingsSnapshot>[0]) =>
        savedResult([]),
    );
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
    const snapshot = createSettingsSnapshotFixture({
      workspaces: {
        "repo-a": {
          workspaceId: "repo-a",
          workspaceName: "repo-a",
          repoPath: "/repo-a",
          worktreeBasePath: "/tmp/worktrees",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {},
          hooks: { postComplete: [] },
          actions: { items: [], defaultActionId: null },
          worktreeCopyPaths: [],
          promptOverrides: repoPromptOverrides,
          agentDefaults: {},
        },
      },
      globalPromptOverrides,
    });

    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(snapshot);
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith({ ...snapshot }, undefined);
      const savedSnapshot = workspaceSaveSettingsSnapshot.mock.calls[0]?.[0];
      if (savedSnapshot === undefined) {
        throw new Error("Expected settings snapshot to be forwarded.");
      }
      expect(Object.keys(savedSnapshot.globalPromptOverrides).sort()).toEqual(
        agentPromptTemplateIdValues.toSorted(),
      );
      expect(Object.keys(savedSnapshot.workspaces["repo-a"]?.promptOverrides ?? {}).sort()).toEqual(
        agentPromptTemplateIdValues.toSorted(),
      );
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("saveGlobalGitConfig refreshes the authoritative snapshot without mutating workspace state", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const applyWorkspaceRecord = mock(() => {});
    const workspaceUpdateGlobalGitConfig = mock(async () => {});
    const optimisticSnapshot = { ...createSettingsSnapshot(), theme: "dark" as const };
    const authoritativeSnapshot = {
      ...createSettingsSnapshot(),
      git: { defaultMergeMethod: "squash" as const },
    };
    const workspaceGetSettingsSnapshot = mock(async () => {
      return workspaceGetSettingsSnapshot.mock.calls.length === 1
        ? optimisticSnapshot
        : authoritativeSnapshot;
    });

    const original = {
      workspaceUpdateGlobalGitConfig: host.workspaceUpdateGlobalGitConfig,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceUpdateGlobalGitConfig = workspaceUpdateGlobalGitConfig;
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

    try {
      await harness.mount();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(optimisticSnapshot);
      await harness.getLatest().saveGlobalGitConfig({
        defaultMergeMethod: "squash",
      });
      expect(workspaceUpdateGlobalGitConfig).toHaveBeenCalledWith({
        defaultMergeMethod: "squash",
      });
      expect(applyWorkspaceRecords).not.toHaveBeenCalled();
      expect(applyWorkspaceRecord).not.toHaveBeenCalled();
      await expect(harness.getLatest().loadSettingsSnapshot()).resolves.toEqual(
        authoritativeSnapshot,
      );
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      host.workspaceUpdateGlobalGitConfig = original.workspaceUpdateGlobalGitConfig;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
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
