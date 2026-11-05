import type { WorkspaceRef } from "@openducktor/contracts";
import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  diffSettingsSnapshot,
  workspaceRefSchema,
  type RepositoryGitProviderContext,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  type SettingsSnapshotSaveResult,
  type RepoActions,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { type QueryClient, QueryObserver, useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { createHookHarness as createSharedHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createDeferred,
  createGitProviderConfigFixture,
  createGitProviderContextFixture,
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
  createWireTaskCardFixture,
  toWireTaskCard,
} from "@/test-utils/shared-test-fixtures";
import { checksQueryKeys } from "@openducktor/frontend-core/queries/checks";
import { repositoryGitProviderContextQueryKeys } from "@openducktor/frontend-core/queries/git-provider-context";
import { gitlabQueryKeys } from "@openducktor/frontend-core/queries/gitlab";
import { runtimeQueryKeys } from "@openducktor/frontend-core/queries/runtime";
import {
  repoTaskDataQueryOptions,
  type RepoTaskData,
  taskQueryKeys,
} from "@openducktor/frontend-core/queries/tasks";
import {
  loadSettingsSnapshotFromQuery,
  repoConfigQueryOptions,
  settingsSnapshotQueryOptions,
  workspaceQueryKeys,
} from "@openducktor/frontend-core/queries/workspace";
import { customAgentRolesQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useRepoSettingsOperations } from "./use-repo-settings-operations";
import { SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS } from "@openducktor/workflows/test-support";

/**
 * The host of every harness in this file. Its commands fail until a test sets them. Each harness
 * gets its own connection and query cache.
 */
const testHost = createTestHostConnection();
const host = testHost.client;

const savedResult = (workspaces: WorkspaceRecord[]): SettingsSnapshotSaveResult => ({
  type: "saved",
  shared: "saved",
  preferences: "saved",
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

  const connection = createTestClientConnection({ host: testHost });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <CaptureQueryClient />
      {children}
    </ClientConnectionProvider>
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
): boolean => {
  if (!Array.isArray(filters?.queryKey)) return false;
  const scope = workspaceRefSchema.safeParse(filters.queryKey[1]);
  return (
    filters.queryKey[0] === repositoryGitProviderContextQueryKeys.all[0] &&
    scope.success &&
    scope.data.repoPath === repoPath
  );
};

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
      repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord(repoPath)),
      createGitProviderContextFixture(),
    );
  }

  return {
    queryClient,
    invalidateQueries,
    resetQueries,
    applyWorkspaceRecords,
    save: harness
      .getLatest()
      .saveSettingsSnapshot(diffSettingsSnapshot(previousSnapshot, normalizedSnapshot)),
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
  hooks: { beforeWorktreeRemoval: ["b"] },
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

describe("use-repo-settings-operations", () => {
  test("saves agent model favorites without loading a settings snapshot", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const initialSnapshot = createSettingsSnapshot();
    const favorites = [
      { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
    ];
    const workspaceGetSettingsSnapshot = mock(async () => initialSnapshot);
    const workspaceUpdateAgentModelFavorites = mock(async () => favorites);
    const original = {
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
      workspaceUpdateAgentModelFavorites: host.workspaceUpdateAgentModelFavorites,
    };
    host.workspaceGetSettingsSnapshot = workspaceGetSettingsSnapshot;
    host.workspaceUpdateAgentModelFavorites = workspaceUpdateAgentModelFavorites;
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
    });

    try {
      await harness.mount();
      await loadSettingsSnapshotFromQuery(harness.getQueryClient());
      await expect(harness.getLatest().saveAgentModelFavorites(favorites)).resolves.toEqual(
        favorites,
      );
      await expect(loadSettingsSnapshotFromQuery(harness.getQueryClient())).resolves.toEqual(
        initialSnapshot,
      );
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
    });

    try {
      await harness.mount();
      await loadSettingsSnapshotFromQuery(harness.getQueryClient());
      await expect(
        harness
          .getLatest()
          .saveAgentModelFavorites([
            { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
          ]),
      ).rejects.toThrow("Could not save favorites");
      await expect(loadSettingsSnapshotFromQuery(harness.getQueryClient())).resolves.toEqual(
        initialSnapshot,
      );
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
      host.workspaceUpdateAgentModelFavorites = original.workspaceUpdateAgentModelFavorites;
    }
  });

  test("throws when loading without an active workspace", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const harness = createHookHarness({
      activeWorkspace: null,
      applyWorkspaceRecords,
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

  test("loads repo settings into normalized form values", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());

    const original = {
      workspaceGetRepoConfig: host.workspaceGetRepoConfig,
    };
    host.workspaceGetRepoConfig = workspaceGetRepoConfig;

    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords,
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
        beforeWorktreeRemovalHooks: ["b"],
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

  test("publishes a full-save preference change to mounted settings observers", async () => {
    const initial = createSettingsSnapshot();
    const saved = { ...initial, system: { preferredOpenInToolId: "zed" as const } };
    const original = {
      get: host.workspaceGetSettingsSnapshot,
      save: host.workspaceSaveSettingsSnapshot,
    };
    host.workspaceGetSettingsSnapshot = async () => saved;
    host.workspaceSaveSettingsSnapshot = async () => savedResult([]);
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
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
        await operations.saveSettingsSnapshot(diffSettingsSnapshot(initial, saved));
      });
      expect(observed.system).toEqual(saved.system);
    } finally {
      unsubscribe();
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.get;
      host.workspaceSaveSettingsSnapshot = original.save;
    }
  });

  test("saves settings snapshot atomically and refreshes normalized snapshot from the host", async () => {
    const applyWorkspaceRecords = mock(() => {});
    const workspaceSaveSettingsSnapshot = mock(async (_snapshot: SettingsSnapshotSaveInput) =>
      savedResult([createWorkspaceRecord()]),
    );
    const explicitChatSettings = {
      steerMessagesByDefault: true,
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
      diffStyle: "unified" as const,
      diffIndicators: "classic" as const,
      diffHeight: "scroll" as const,
      lineOverflow: "scroll" as const,
      hunkSeparators: "metadata" as const,
      showConversationMinimap: false,
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
      harness
        .getQueryClient()
        .setQueryData(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a")), { tasks: [] });
      await harness
        .getLatest()
        .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), snapshot));
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(
        diffSettingsSnapshot(createSettingsSnapshot(), snapshot),
        undefined,
      );
      expect(workspaceSaveSettingsSnapshot.mock.calls[0]?.[0]?.global?.chat).toEqual(
        explicitChatSettings,
      );
      expect(
        workspaceSaveSettingsSnapshot.mock.calls[0]?.[0]?.autopilot?.alwaysStartQaReviewsFresh,
      ).toBe(true);
      expect(applyWorkspaceRecords).toHaveBeenCalledWith([createWorkspaceRecord()]);
      await expect(loadSettingsSnapshotFromQuery(harness.getQueryClient())).resolves.toEqual(
        normalizedSnapshot,
      );
      expect(
        harness
          .getQueryClient()
          .getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.autopilot
          .alwaysStartQaReviewsFresh,
      ).toBe(true);
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(tasksList).toHaveBeenCalledWith({ workspaceId: "repo-a", repoPath: "/repo-a" });
      expect(
        harness
          .getQueryClient()
          .getQueryState(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a"))),
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
    const refreshedTasks = [createWireTaskCardFixture({ title: "New retention" })];
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
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData(createWorkspaceRecord("/repo-b")), {
        tasks: [],
      });
      const pendingTaskRead = queryClient.fetchQuery(
        repoTaskDataQueryOptions(createWorkspaceRecord("/repo-a")),
      );
      void pendingTaskRead.catch(() => {});
      await firstTaskReadStarted.promise;

      await harness
        .getLatest()
        .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), normalizedSnapshot));

      expect(tasksList).toHaveBeenCalledTimes(2);
      expect(
        queryClient
          .getQueryData<RepoTaskData>(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a")))
          ?.tasks.map(toWireTaskCard),
      ).toEqual(refreshedTasks);
      expect(
        queryClient.getQueryState(taskQueryKeys.repoData(createWorkspaceRecord("/repo-b")))
          ?.isInvalidated,
      ).toBe(true);

      firstTaskRead.resolve([createWireTaskCardFixture({ title: "Old retention" })]);
      await Promise.allSettled([pendingTaskRead]);
      expect(
        queryClient
          .getQueryData<RepoTaskData>(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a")))
          ?.tasks.map(toWireTaskCard),
      ).toEqual(refreshedTasks);
    } finally {
      firstTaskRead.resolve([createWireTaskCardFixture({ title: "Old retention" })]);
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
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a")), {
        tasks: [],
      });

      await expect(
        harness
          .getLatest()
          .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), normalizedSnapshot)),
      ).resolves.toMatchObject({ type: "saved" });

      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<SettingsSnapshot>(workspaceQueryKeys.settingsSnapshot())?.kanban
          .doneVisibleDays,
      ).toBe(7);
      expect(
        queryClient.getQueryState(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a"))),
      ).toMatchObject({
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

  test.each([false, true])(
    "marks the cached settings stale after a refresh failure, with cached snapshot %s",
    async (hasSnapshot) => {
      const workspaces = [createWorkspaceRecord()];
      const workspaceSaveSettingsSnapshot = mock(async (): Promise<SettingsSnapshotSaveResult> => ({
        type: "saved",
        shared: "saved",
        preferences: "saved",
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
      });

      try {
        await harness.mount();
        const initial = createSettingsSnapshot();
        const saved = { ...initial, chat: { ...initial.chat, steerMessagesByDefault: true } };
        const queryClient = harness.getQueryClient();
        const key = workspaceQueryKeys.settingsSnapshot();
        if (hasSnapshot) queryClient.setQueryData(key, initial);
        const outcome = await harness
          .getLatest()
          .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), saved));

        expect(outcome).toMatchObject({
          type: "saved",
          refreshError: "settings read failed",
          runtimeApplications: [{ kind: "opencode", outcome: "failed" }],
        });
        expect(applyWorkspaceRecords).toHaveBeenCalledWith(workspaces);
        expect(
          harness.getQueryClient().getQueryData<WorkspaceRecord[]>(workspaceQueryKeys.list()),
        ).toEqual(workspaces);
        expect(queryClient.getQueryData<SettingsSnapshot>(key)).toEqual(
          hasSnapshot ? initial : undefined,
        );
        expect(queryClient.getQueryState(key)).toMatchObject({
          error: { message: "settings read failed" },
          isInvalidated: true,
        });
      } finally {
        await harness.unmount();
        host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
        host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
      }
    },
  );

  test("a partial save returns its result and marks the cached settings stale after reload failure", async () => {
    const initial = createSettingsSnapshot();
    const original = {
      save: host.workspaceSaveSettingsSnapshot,
      get: host.workspaceGetSettingsSnapshot,
    };
    host.workspaceSaveSettingsSnapshot = async () => ({
      type: "partial",
      shared: "saved",
      preferences: { message: "Preferences could not be written." },
      workspaces: [],
      runtimeApplications: [],
    });
    host.workspaceGetSettingsSnapshot = async () => {
      throw new Error("Settings could not reload.");
    };
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
    });
    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      const key = workspaceQueryKeys.settingsSnapshot();
      queryClient.setQueryData(key, initial);
      const result = await harness.getLatest().saveSettingsSnapshot({
        global: { git: { defaultMergeMethod: "squash" }, chat: { steerMessagesByDefault: true } },
      });
      expect(result.type).toBe("partial");
      expect(result).toHaveProperty("refreshError", "Settings could not reload.");
      expect(queryClient.getQueryData<SettingsSnapshot>(key)).toBe(initial);
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.save;
      host.workspaceGetSettingsSnapshot = original.get;
    }
  });

  test("cancels an older settings read and publishes the refreshed snapshot after a save", async () => {
    const initial = createSettingsSnapshot();
    const saved = { ...initial, chat: { ...initial.chat, steerMessagesByDefault: true } };
    const oldRead = createDeferred<SettingsSnapshot>();
    const refresh = createDeferred<SettingsSnapshot>();
    const refreshStarted = createDeferred<void>();
    const original = {
      get: host.workspaceGetSettingsSnapshot,
      save: host.workspaceSaveSettingsSnapshot,
    };
    let reads = 0;
    host.workspaceGetSettingsSnapshot = () => {
      if (++reads === 1) return oldRead.promise;
      refreshStarted.resolve();
      return refresh.promise;
    };
    host.workspaceSaveSettingsSnapshot = async () => savedResult([]);
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
    });
    let unsubscribe = () => {};
    try {
      await harness.mount();
      const client = harness.getQueryClient();
      const key = workspaceQueryKeys.settingsSnapshot();
      client.setQueryData(key, initial);
      const observer = new QueryObserver(client, settingsSnapshotQueryOptions());
      let observed = initial;
      unsubscribe = observer.subscribe((result) => {
        if (result.data) observed = result.data;
      });
      const pendingRead = client
        .fetchQuery({ ...settingsSnapshotQueryOptions(), staleTime: 0 })
        .catch(() => undefined);
      const save = harness
        .getLatest()
        .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), saved));
      await refreshStarted.promise;
      oldRead.resolve({ ...initial, theme: "dark" });
      await pendingRead;
      expect(client.getQueryData<SettingsSnapshot>(key)).toBe(initial);
      refresh.resolve(saved);
      await save;
      expect(observed.chat.steerMessagesByDefault).toBe(true);
      expect(client.getQueryData<SettingsSnapshot>(key)).toEqual(saved);
    } finally {
      oldRead.resolve(initial);
      refresh.resolve(saved);
      unsubscribe();
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original.get;
      host.workspaceSaveSettingsSnapshot = original.save;
    }
  });

  test("does not publish Chat settings when runtime impact changes without a write", async () => {
    const initial = createSettingsSnapshot();
    const saved = { ...initial, chat: { ...initial.chat, steerMessagesByDefault: true } };
    const original = host.workspaceSaveSettingsSnapshot;
    host.workspaceSaveSettingsSnapshot = async () => ({
      type: "runtime_impact_changed",
      impact: { confirmation: "changed", kinds: [], workspaces: [] },
    });
    const harness = createHookHarness({
      activeWorkspace: createWorkspaceRecord(),
      applyWorkspaceRecords: () => {},
    });
    try {
      await harness.mount();
      const client = harness.getQueryClient();
      const key = workspaceQueryKeys.settingsSnapshot();
      client.setQueryData(key, initial);
      const result = await harness
        .getLatest()
        .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), saved));
      expect(result.type).toBe("runtime_impact_changed");
      expect(client.getQueryData<SettingsSnapshot>(key)).toBe(initial);
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original;
    }
  });

  test("reads the task lists of every open workspace after retention settings change", async () => {
    const openWorkspaces = [
      createWorkspaceRecord("/repo-a"),
      { ...createWorkspaceRecord("/repo-b"), isActive: false },
    ];
    const normalizedSnapshot = createSettingsSnapshotFixture({ kanban: { doneVisibleDays: 7 } });
    const workspaceSaveSettingsSnapshot = mock(async () => savedResult(openWorkspaces));
    const workspaceGetSettingsSnapshot = mock(async () => normalizedSnapshot);
    const tasksList = mock(async (_scope: WorkspaceRef) => []);
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
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData(createWorkspaceRecord("/repo-b")), {
        tasks: [],
      });

      await expect(
        harness
          .getLatest()
          .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), normalizedSnapshot)),
      ).resolves.toMatchObject({ type: "saved" });

      expect(tasksList.mock.calls).toEqual([
        [{ workspaceId: "repo-a", repoPath: "/repo-a" }],
        [{ workspaceId: "repo-b", repoPath: "/repo-b" }],
      ]);
      expect(
        queryClient.getQueryState(taskQueryKeys.repoData(createWorkspaceRecord("/repo-b"))),
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
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), createSettingsSnapshot());
      queryClient.setQueryData(taskQueryKeys.repoData(createWorkspaceRecord("/repo-a")), {
        tasks: [],
      });

      await expect(
        harness
          .getLatest()
          .saveSettingsSnapshot(diffSettingsSnapshot(createSettingsSnapshot(), normalizedSnapshot)),
      ).resolves.toMatchObject({ type: "saved" });

      expect(tasksList).toHaveBeenCalledTimes(1);
      expect(tasksList).toHaveBeenCalledWith({ workspaceId: "repo-a", repoPath: "/repo-b" });
      expect(queryClient.getQueryState(taskQueryKeys.repoData(reboundWorkspace))).toMatchObject({
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
          hooks: { beforeWorktreeRemoval: ["bun run cleanup"] },
        },
      },
    });
    const run = await startSettingsSave({ previousSnapshot, normalizedSnapshot });

    try {
      await run.save;

      expect(run.invalidateQueries).toHaveBeenCalledWith({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
      });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: gitlabQueryKeys.all });
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
        await operations.saveSettingsSnapshot(
          diffSettingsSnapshot(createSettingsSnapshot(), normalizedSnapshot),
        );
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
        queryKey: repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord("/repo-b")),
      });
      expect(run.resetQueries).not.toHaveBeenCalledWith({
        queryKey: repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord("/repo-a")),
      });
      expect(run.invalidateQueries).toHaveBeenCalledWith({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
      });
      // A provider change can delete a GitLab account, so the account and status reads refresh.
      expect(run.invalidateQueries).toHaveBeenCalledWith({ queryKey: gitlabQueryKeys.all });
      expect(run.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: checksQueryKeys.all });
      expect(
        run.queryClient.getQueryData(
          repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord("/repo-b")),
        ),
      ).toBeUndefined();
      expect(
        run.queryClient.getQueryData<RepositoryGitProviderContext>(
          repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord("/repo-a")),
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
        queryKey: repositoryGitProviderContextQueryKeys.repo(createWorkspaceRecord("/repo-b")),
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
      normalizedSnapshot: { ...snapshot, chat: { ...snapshot.chat, steerMessagesByDefault: true } },
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
    });
    const globalPromptOverrides = Object.fromEntries(
      SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS.map((templateId) => [
        templateId,
        {
          template: `global ${templateId}`,
          baseVersion: 1,
          enabled: true,
        },
      ]),
    );
    const repoPromptOverrides = Object.fromEntries(
      SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS.map((templateId) => [
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
          hooks: { beforeWorktreeRemoval: [] },
          actions: { items: [], defaultActionId: null },
          worktreeCopyPaths: [],
          promptOverrides: repoPromptOverrides,
          agentDefaults: {},
        },
      },
      globalPromptOverrides,
    });

    const baseline = createSettingsSnapshotFixture({
      workspaces: { "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") },
    });
    try {
      await harness.mount();
      await harness.getLatest().saveSettingsSnapshot(diffSettingsSnapshot(baseline, snapshot));
      expect(workspaceSaveSettingsSnapshot).toHaveBeenCalledWith(
        diffSettingsSnapshot(baseline, snapshot),
        undefined,
      );
      const savedSnapshot = workspaceSaveSettingsSnapshot.mock.calls[0]?.[0];
      if (savedSnapshot === undefined) {
        throw new Error("Expected settings snapshot to be forwarded.");
      }
      expect(Object.keys(savedSnapshot.global?.globalPromptOverrides?.create ?? {}).sort()).toEqual(
        SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS.toSorted(),
      );
      expect(
        Object.keys(savedSnapshot.workspaces?.["repo-a"]?.promptOverrides?.create ?? {}).sort(),
      ).toEqual(SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS.toSorted());
    } finally {
      await harness.unmount();
      host.workspaceSaveSettingsSnapshot = original.workspaceSaveSettingsSnapshot;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("detectGithubRepository forwards detection to the host", async () => {
    const applyWorkspaceRecords = mock(() => {});
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
    });

    try {
      await harness.mount();
      await expect(
        harness.getLatest().detectGithubRepository({ workspaceId: "repo-a", repoPath: "/repo-a" }),
      ).resolves.toEqual({
        host: "github.com",
        owner: "openai",
        name: "openducktor",
      });
      expect(workspaceDetectGithubRepository).toHaveBeenCalledWith({
        workspaceId: "repo-a",
        repoPath: "/repo-a",
      });
    } finally {
      await harness.unmount();
      host.workspaceDetectGithubRepository = original.workspaceDetectGithubRepository;
    }
  });
});
