import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentFileSearchResult, AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { getSessionMessagesSlice } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createDeferred,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  resolveActiveSessionSelectionState,
  useAgentStudioModelSelection,
} from "./use-agent-studio-model-selection";

enableReactActEnvironment();

let messageCounter = 0;

type HookArgs = Parameters<typeof useAgentStudioModelSelection>[0];
type LegacyHookArgs = HookArgs & { workspaceRepoPath?: string | null };

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: [],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    {
      name: "spec-agent",
      mode: "primary",
      hidden: false,
      color: "#f59e0b",
    },
    {
      name: "build-agent",
      mode: "primary",
      hidden: false,
    },
  ],
};

const ALTERNATE_CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-opus",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-opus",
      modelName: "Claude Opus",
      variants: ["extended"],
      contextWindow: 300_000,
    },
  ],
  defaultModelsByProvider: {
    anthropic: "claude-opus",
  },
  profiles: [
    {
      name: "planner-agent",
      mode: "primary",
      hidden: false,
      color: "#0ea5e9",
    },
  ],
};

const CATALOG_WITHOUT_PROFILES: AgentModelCatalog = {
  ...CATALOG,
  profiles: [],
};

const EMPTY_CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  defaultModelsByProvider: {},
  profiles: [],
};

const FILE_SEARCH_RESULTS: AgentFileSearchResult[] = [
  {
    id: "src/main.ts",
    path: "src/main.ts",
    name: "main.ts",
    kind: "code",
  },
];

const createRepoSettings = (
  specDefault: RepoSettingsInput["agentDefaults"]["spec"] | null,
): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: specDefault,
    planner: null,
    build: null,
    qa: null,
  },
});

const createActiveSession = (overrides = {}) =>
  createAgentSessionFixture({
    modelCatalog: CATALOG,
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    },
    ...overrides,
  });

const createHookHarness = (
  initialProps: LegacyHookArgs,
  options: { runtimeDefinitions?: RuntimeDescriptor[] } = {},
) => {
  const runtimeDefinitions = options.runtimeDefinitions ?? [OPENCODE_RUNTIME_DESCRIPTOR];
  const runtimeDefinitionsContext = {
    runtimeDefinitions,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => runtimeDefinitions,
    loadRepoRuntimeCatalog: async () => {
      throw new Error("Test runtime catalog loader was not configured.");
    },
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  } satisfies React.ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      QueryProvider,
      { useIsolatedClient: true },
      createElement(
        RuntimeDefinitionsContext.Provider,
        { value: runtimeDefinitionsContext },
        children,
      ),
    );

  return createSharedHookHarness(
    (props: LegacyHookArgs) =>
      useAgentStudioModelSelection({
        ...props,
        activeWorkspace:
          "workspaceRepoPath" in props
            ? props.workspaceRepoPath
              ? createActiveWorkspace(props.workspaceRepoPath)
              : null
            : (props.activeWorkspace ?? null),
      }),
    initialProps,
    { wrapper },
  );
};

const createAssistantMessage = (
  overrides: Partial<Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>> = {},
): AgentChatMessage => {
  messageCounter += 1;
  return {
    id: `assistant-message-${messageCounter}`,
    role: "assistant",
    content: "",
    timestamp: "2026-02-20T10:00:00.000Z",
    meta: {
      kind: "assistant",
      agentRole: "spec",
      ...overrides,
    },
  };
};

const createBaseProps = (overrides: Partial<LegacyHookArgs> = {}): LegacyHookArgs => ({
  activeWorkspace: createActiveWorkspace("/repo"),
  activeSession: null,
  activeSessionSummary: null,
  role: "spec",
  repoSettings: createRepoSettings(null),
  updateAgentSessionModel: () => {},
  loadCatalog: async () => CATALOG,
  ...overrides,
});

describe("useAgentStudioModelSelection", () => {
  test("prefers hydrated session runtime fields while preserving summary selection fallback", () => {
    const hydratedSession = createActiveSession({
      runtimeKind: "opencode",
      runtimeRoute: { type: "local_http", endpoint: "http://localhost:3000" },
      workingDirectory: "/repo/session-worktree",
    });
    const summary = {
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "spec" as const,
      scenario: "spec_initial" as const,
      status: "idle" as const,
      startedAt: "2026-02-20T10:00:00.000Z",
      workingDirectory: "/repo",
      runtimeKind: "opencode" as const,
      selectedModel: {
        runtimeKind: "opencode" as const,
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "build-agent",
      },
      pendingPermissions: [],
      pendingQuestions: [],
    };

    const state = resolveActiveSessionSelectionState(hydratedSession, summary);

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(hydratedSession.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://localhost:3000",
    });
    expect(state.workingDirectory).toBe("/repo/session-worktree");
    expect(state.isLoadingModelCatalog).toBe(false);
    expect(state.hasSelection).toBe(true);
  });

  test("keeps summary selection available while the hydrated session is missing", () => {
    const summary = {
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "spec" as const,
      scenario: "spec_initial" as const,
      status: "idle" as const,
      startedAt: "2026-02-20T10:00:00.000Z",
      workingDirectory: "/repo",
      runtimeKind: "opencode" as const,
      selectedModel: {
        runtimeKind: "opencode" as const,
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "build-agent",
      },
      pendingPermissions: [],
      pendingQuestions: [],
    };

    const state = resolveActiveSessionSelectionState(null, summary);

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(summary.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo");
    expect(state.runtimeRoute).toBeNull();
    expect(state.isLoadingModelCatalog).toBe(true);
    expect(state.hasSelection).toBe(true);
  });

  test("uses repo role defaults when available", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("keeps repo defaults selectable when composer catalog is unavailable", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build-agent",
      });
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("preserves selected agent profile when catalog does not expose profile metadata", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        }),
        loadCatalog: async () => CATALOG_WITHOUT_PROFILES,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

    expect(harness.getLatest().selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("publishes agent colors from composer catalog before a session is started", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.agentOptions.length > 0);

    const state = harness.getLatest();
    expect(state.activeSessionAgentColors).toMatchObject({
      "spec-agent": "#f59e0b",
    });

    await harness.unmount();
  });

  test("keeps the selected session model while the full session object is still hydrating", async () => {
    const harness = createHookHarness(
      createBaseProps({
        activeSession: null,
        activeSessionSummary: {
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "spec",
          scenario: "spec_initial",
          status: "idle",
          startedAt: "2026-02-20T10:00:00.000Z",
          workingDirectory: "/repo",
          runtimeKind: "opencode",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-sonnet",
            profileId: "build-agent",
          },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "build-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not query session slash commands until the active session exposes its runtime kind", async () => {
    const readSessionSlashCommands = mock(async () => ({
      commands: [{ id: "review", trigger: "review", title: "review", hints: [] }],
    }));

    const harness = createHookHarness(
      createBaseProps({
        activeSession: createActiveSession({
          runtimeKind: null,
          selectedModel: {
            runtimeKind: "queued-runtime",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "default",
            profileId: "spec-agent",
          },
        }),
        readSessionSlashCommands,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.isSlashCommandsLoading === false);

    expect(readSessionSlashCommands).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("searches repo files through the repo runtime before a session starts", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const harness = createHookHarness(
      createBaseProps({
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().supportsFileSearch).toBe(true);

      let results: AgentFileSearchResult[] = [];
      await harness.run(async (state) => {
        results = await state.searchFiles("src");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(loadFileSearch).toHaveBeenCalledWith("/repo", "opencode", "src");
    } finally {
      await harness.unmount();
    }
  });

  test("uses the active session runtime for file search", async () => {
    const readSessionFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const activeSession = createActiveSession({
      runtimeKind: "opencode",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/repo/session-worktree",
    });
    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        readSessionFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().supportsFileSearch).toBe(true);

      let results: AgentFileSearchResult[] = [];
      await harness.run(async (state) => {
        results = await state.searchFiles("");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(readSessionFileSearch).toHaveBeenCalledWith(
        "/repo",
        "opencode",
        "/repo/session-worktree",
        "",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("queries session slash commands for stdio OpenCode sessions", async () => {
    const readSessionSlashCommands = mock(async () => ({
      commands: [{ id: "review", trigger: "review", title: "review", hints: [] }],
    }));
    const harness = createHookHarness(
      createBaseProps({
        activeSession: createActiveSession({
          runtimeKind: "opencode",
          runtimeRoute: { type: "stdio", identity: "runtime-stdio" },
          workingDirectory: "/repo/session-worktree",
        }),
        readSessionSlashCommands,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSlashCommandsLoading === false);

      expect(readSessionSlashCommands).toHaveBeenCalledTimes(1);
      expect(readSessionSlashCommands).toHaveBeenCalledWith("/repo", "opencode");
      expect(harness.getLatest().slashCommandsError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("fails fast when active session file search is requested before runtime connection is ready", async () => {
    const readSessionFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const harness = createHookHarness(
      createBaseProps({
        activeSession: createActiveSession({
          runtimeKind: null,
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "default",
            profileId: "spec-agent",
          },
        }),
        readSessionFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      await expect(harness.getLatest().searchFiles("src")).rejects.toThrow(
        "Active session file search is unavailable until the session runtime is ready.",
      );
      expect(readSessionFileSearch).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("propagates adapter errors when active session file search uses stdio OpenCode session", async () => {
    const readSessionFileSearch = mock(async () => {
      throw new Error("file search unavailable");
    });
    const harness = createHookHarness(
      createBaseProps({
        activeSession: createActiveSession({
          runtimeKind: "opencode",
          runtimeRoute: { type: "stdio", identity: "runtime-stdio" },
          workingDirectory: "/repo/session-worktree",
        }),
        readSessionFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      await expect(harness.getLatest().searchFiles("src")).rejects.toThrow(
        "file search unavailable",
      );
      expect(readSessionFileSearch).toHaveBeenCalledTimes(1);
      expect(readSessionFileSearch).toHaveBeenCalledWith(
        "/repo",
        "opencode",
        "/repo/session-worktree",
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("updates draft selections through model and variant handlers", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-sonnet");

    await harness.run(() => {
      harness.getLatest().handleSelectModel("openai/gpt-5");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectVariant("high");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    await harness.run(() => {
      harness.getLatest().handleSelectAgent("build-agent");
    });

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("routes selection updates to active sessions via callback", async () => {
    const updateAgentSessionModel = mock(() => {});
    const activeSession = createActiveSession();

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        updateAgentSessionModel,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectVariant("high");
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith("external-1", {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("preserves active session model when catalog cannot produce a replacement", async () => {
    const updateAgentSessionModel = mock(() => {});
    const activeSession = createActiveSession({
      modelCatalog: EMPTY_CATALOG,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        updateAgentSessionModel,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    expect(harness.getLatest().selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
    expect(updateAgentSessionModel).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("does not load the repo composer catalog while an active session owns runtime catalog loading", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const activeSession = createActiveSession({
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog,
      }),
    );

    try {
      await harness.mount();

      expect(loadCatalog).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loading while no catalog source is available for an active session", async () => {
    const activeSession = createActiveSession({
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog: async () => CATALOG,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("invalidates composer catalog and ignores stale repo loads when active repo changes", async () => {
    const repoALoad = createDeferred<AgentModelCatalog>();
    const repoBLoad = createDeferred<AgentModelCatalog>();
    const loadCatalog = mock(
      (repoPath: string, _runtimeKind: string): Promise<AgentModelCatalog> => {
        if (repoPath === "/repo-a") {
          return repoALoad.promise;
        }
        if (repoPath === "/repo-b") {
          return repoBLoad.promise;
        }
        return Promise.reject(new Error(`Unexpected repo path: ${repoPath}`));
      },
    );

    const harness = createHookHarness(
      createBaseProps({
        workspaceRepoPath: "/repo-a",
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);

      await harness.update(
        createBaseProps({
          workspaceRepoPath: "/repo-b",
          loadCatalog,
        }),
      );

      expect(loadCatalog).toHaveBeenCalledTimes(2);
      expect(loadCatalog.mock.calls[0]).toEqual(["/repo-a", "opencode"]);
      expect(loadCatalog.mock.calls[1]).toEqual(["/repo-b", "opencode"]);

      await harness.run(async () => {
        repoALoad.resolve(CATALOG);
        await repoALoad.promise;
      });

      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
      expect(harness.getLatest().selectedModelSelection).toBeNull();

      await harness.run(async () => {
        repoBLoad.resolve(ALTERNATE_CATALOG);
        await repoBLoad.promise;
      });
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "claude-opus",
      );

      const state = harness.getLatest();
      expect(state.selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      repoALoad.resolve(CATALOG);
      repoBLoad.resolve(ALTERNATE_CATALOG);
      await harness.unmount();
    }
  });

  test("uses defaults from the newly selected repository after switching repos", async () => {
    const loadCatalog = mock(
      async (repoPath: string, _runtimeKind: string): Promise<AgentModelCatalog> => {
        if (repoPath === "/repo-a") {
          return CATALOG;
        }
        if (repoPath === "/repo-b") {
          return ALTERNATE_CATALOG;
        }
        throw new Error(`Unexpected repo path: ${repoPath}`);
      },
    );

    const harness = createHookHarness(
      createBaseProps({
        workspaceRepoPath: "/repo-a",
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "gpt-5" &&
          state.selectedModelSelection.variant === "high",
      );

      await harness.run(() => {
        harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
      });
      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-sonnet");

      await harness.update(
        createBaseProps({
          workspaceRepoPath: "/repo-b",
          repoSettings: createRepoSettings({
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-opus",
            variant: "extended",
            profileId: "planner-agent",
          }),
          loadCatalog,
        }),
      );

      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-opus");

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not reuse stale repo defaults while waiting for the next repo settings", async () => {
    const harness = createHookHarness(
      createBaseProps({
        workspaceRepoPath: "/repo-a",
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "gpt-5",
      );

      await harness.update(
        createBaseProps({
          workspaceRepoPath: "/repo-b",
          repoSettings: null,
          loadCatalog: async () => {
            throw new Error("catalog unavailable");
          },
        }),
      );

      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection === null &&
          state.selectionForNewSession === null,
      );

      await harness.update(
        createBaseProps({
          workspaceRepoPath: "/repo-b",
          repoSettings: createRepoSettings({
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-opus",
            variant: "extended",
            profileId: "planner-agent",
          }),
          loadCatalog: async () => {
            throw new Error("catalog unavailable");
          },
        }),
      );

      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-opus");
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("derives context usage from latest assistant message with descriptor fallback", async () => {
    const activeSession = createActiveSession({
      messages: [
        createAssistantMessage({
          totalTokens: 12,
          contextWindow: 40_000,
          outputLimit: 1000,
        }),
        createAssistantMessage({
          totalTokens: 24,
          providerId: "openai",
          modelId: "gpt-5",
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 24,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("prefers live session context usage before final assistant completion", async () => {
    const activeSession = createActiveSession({
      contextUsage: {
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      },
      messages: [
        createAssistantMessage({
          totalTokens: 12,
          contextWindow: 40_000,
          outputLimit: 1_000,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("merges incomplete idle live usage with assistant message metadata", async () => {
    const activeSession = createActiveSession({
      status: "idle",
      selectedModel: null,
      modelCatalog: null,
      contextUsage: {
        totalTokens: 31,
      },
      messages: [
        createAssistantMessage({
          totalTokens: 24,
          contextWindow: 40_000,
          outputLimit: 1_000,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 31,
        contextWindow: 40_000,
        outputLimit: 1_000,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("prefers selected model fallback metadata over older assistant message history", async () => {
    const primaryModel = CATALOG.models[0];
    const secondaryModel = CATALOG.models[1];
    if (!primaryModel || !secondaryModel) {
      throw new Error("Expected catalog fixture models");
    }
    const catalogWithSelectionFallback: AgentModelCatalog = {
      ...CATALOG,
      models: [
        primaryModel,
        {
          ...secondaryModel,
          contextWindow: 100_000,
          outputLimit: 4_096,
        },
      ],
    };
    const activeSession = createActiveSession({
      status: "idle",
      modelCatalog: catalogWithSelectionFallback,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
      contextUsage: {
        totalTokens: 31,
      },
      messages: [
        createAssistantMessage({
          totalTokens: 24,
          contextWindow: 40_000,
          outputLimit: 1_000,
        }),
      ],
    });

    const harness = createHookHarness(createBaseProps({ activeSession }));

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 31,
        contextWindow: 100_000,
        outputLimit: 4_096,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("falls back to the selected model context window when message + descriptor metadata are missing", async () => {
    const primaryModel = CATALOG.models[0];
    const secondaryModel = CATALOG.models[1];
    if (!primaryModel || !secondaryModel) {
      throw new Error("Expected catalog fixture models");
    }
    const catalogWithContextFallback: AgentModelCatalog = {
      ...CATALOG,
      models: [
        {
          ...primaryModel,
        },
        {
          ...secondaryModel,
          contextWindow: 100_000,
        },
      ],
    };
    const activeSession = createActiveSession({
      modelCatalog: catalogWithContextFallback,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
      messages: [
        createAssistantMessage({
          totalTokens: 33,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 33,
        contextWindow: 100_000,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("uses an older assistant message for context usage when the latest tokenized one is incomplete", async () => {
    const activeSession = createActiveSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
      messages: [
        createAssistantMessage({
          totalTokens: 11,
          contextWindow: 25_000,
        }),
        createAssistantMessage({
          totalTokens: 22,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 11,
        contextWindow: 25_000,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps live context usage stable when only session messages change", async () => {
    const contextUsage = {
      totalTokens: 44,
      contextWindow: 150_000,
      outputLimit: 4_096,
      providerId: "openai",
      modelId: "gpt-5",
    };
    const activeSession = createActiveSession({
      contextUsage,
      messages: [createAssistantMessage({ totalTokens: 12, contextWindow: 10_000 })],
    });
    const harness = createHookHarness(createBaseProps({ activeSession }));

    try {
      await harness.mount();
      const previousUsage = harness.getLatest().activeSessionContextUsage;

      await harness.update(
        createBaseProps({
          activeSession: {
            ...activeSession,
            messages: [
              ...getSessionMessagesSlice(activeSession, 0),
              {
                id: "tool-1",
                role: "tool",
                content: "apply_patch",
                timestamp: "2026-02-20T10:01:00.000Z",
                meta: {
                  kind: "tool",
                  partId: "part-tool-1",
                  callId: "call-tool-1",
                  tool: "apply_patch",
                  status: "running",
                },
              },
            ],
            contextUsage,
          },
        }),
      );

      expect(harness.getLatest().activeSessionContextUsage).toBe(previousUsage);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps fallback context usage stable when unrelated tail messages change", async () => {
    const activeSession = createActiveSession({
      contextUsage: null,
      messages: [
        createAssistantMessage({
          totalTokens: 21,
          contextWindow: 48_000,
        }),
      ],
    });
    const harness = createHookHarness(createBaseProps({ activeSession }));

    try {
      await harness.mount();
      const previousUsage = harness.getLatest().activeSessionContextUsage;

      await harness.update(
        createBaseProps({
          activeSession: {
            ...activeSession,
            messages: [
              ...getSessionMessagesSlice(activeSession, 0),
              {
                id: "tool-tail-1",
                role: "tool",
                content: "read",
                timestamp: "2026-02-20T10:01:00.000Z",
                meta: {
                  kind: "tool",
                  partId: "part-tool-tail-1",
                  callId: "call-tool-tail-1",
                  tool: "read",
                  status: "completed",
                },
              },
            ],
            contextUsage: null,
          },
        }),
      );

      expect(harness.getLatest().activeSessionContextUsage).toBe(previousUsage);
    } finally {
      await harness.unmount();
    }
  });
});
