import { describe, expect, mock, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoRuntimeRef,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSubagentCatalog,
} from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { QueryProvider } from "@/lib/query-provider";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import {
  createSessionMessagesState,
  getSessionMessagesSlice,
} from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createDeferred,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { useAgentStudioChatComposer } from "./use-agent-studio-chat-composer";

enableReactActEnvironment();

let messageCounter = 0;

type HookArgs = Parameters<typeof useAgentStudioChatComposer>[0];
type BasePropsOverrides = Partial<Omit<HookArgs, "selectedSession">> & {
  selectedSession?: Partial<HookArgs["selectedSession"]>;
  loadedSession?: AgentSessionState | null;
  selectedSessionIdentity?: AgentSessionIdentity | null;
  selectedSessionModel?: AgentSessionState["selectedModel"];
  sessionRuntimeData?: HookArgs["selectedSession"]["runtimeData"];
  repoReadinessState?: HookArgs["selectedSession"]["runtimeReadiness"]["state"];
  selectedSessionSummary?: AgentSessionSummary | null;
};

const createSessionRuntimeData = (
  overrides: Partial<HookArgs["selectedSession"]["runtimeData"]> = {},
): HookArgs["selectedSession"]["runtimeData"] => ({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  error: null,
  ...overrides,
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

const SUBAGENT_CATALOG: AgentSubagentCatalog = {
  subagents: [
    {
      id: "reviewer",
      name: "reviewer",
      label: "Reviewer",
    },
  ],
};

const CATALOG_WITHOUT_PROFILES: AgentModelCatalog = {
  ...CATALOG,
  profiles: [],
};

const CATALOG_WITH_TRANSPORT_MODEL_IDS: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["medium", "high"],
    },
    {
      id: "claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
};

const EMPTY_CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  defaultModelsByProvider: {},
  profiles: [],
};

const CODEX_CATALOG: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
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
  defaultRuntimeKind: RepoSettingsInput["defaultRuntimeKind"] = "opencode",
): RepoSettingsInput => ({
  defaultRuntimeKind,
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

type CreateLoadedSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const createLoadedSession = (overrides: CreateLoadedSessionOverrides = {}) =>
  createAgentSessionFixture({
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
  initialProps: HookArgs,
  options: {
    runtimeDefinitions?: RuntimeDescriptor[];
    availableRuntimeDefinitions?: RuntimeDescriptor[];
  } = {},
) => {
  const runtimeDefinitions = options.runtimeDefinitions ?? [OPENCODE_RUNTIME_DESCRIPTOR];
  const availableRuntimeDefinitions = options.availableRuntimeDefinitions ?? runtimeDefinitions;
  const runtimeDefinitionsContext = {
    runtimeDefinitions,
    availableRuntimeDefinitions,
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => runtimeDefinitions,
    loadRepoRuntimeCatalog: async () => {
      throw new Error("Test runtime catalog loader was not configured.");
    },
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeSkills: async () => ({ skills: [] }),
    loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
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
    (props: HookArgs) => useAgentStudioChatComposer(props),
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

const createBaseProps = (overrides: BasePropsOverrides = {}): HookArgs => {
  const {
    selectedSession: selectedSessionOverride,
    loadedSession: loadedSessionOverride,
    selectedSessionIdentity: selectedSessionIdentityOverride,
    selectedSessionModel: selectedSessionModelOverride,
    sessionRuntimeData: sessionRuntimeDataOverride,
    repoReadinessState,
    selectedSessionSummary: selectedSessionSummaryOverride,
    role: roleOverride,
    ...hookOverrides
  } = overrides;
  const loadedSession = "loadedSession" in overrides ? (loadedSessionOverride ?? null) : null;
  const role = roleOverride ?? "spec";
  const selectedSessionIdentity =
    "selectedSessionIdentity" in overrides
      ? (selectedSessionIdentityOverride ?? null)
      : loadedSession
        ? toAgentSessionIdentity(loadedSession)
        : null;
  const selectedSessionSummary =
    "selectedSessionSummary" in overrides ? (selectedSessionSummaryOverride ?? null) : null;
  const selectedSessionModel =
    "selectedSessionModel" in overrides
      ? (selectedSessionModelOverride ?? null)
      : (loadedSession?.selectedModel ?? selectedSessionSummary?.selectedModel ?? null);

  return {
    workspaceRepoPath: "/repo",
    selectedSession: {
      identity: selectedSessionIdentity,
      activityState: null,
      selectedModel: selectedSessionModel,
      loadedSession,
      runtimeData: sessionRuntimeDataOverride ?? createSessionRuntimeData(),
      runtimeReadiness: {
        state: repoReadinessState ?? "ready",
        message: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      transcriptState: { kind: "visible" },
      sessionAuxiliaryError: null,
      ...selectedSessionOverride,
    },
    role,
    reusablePrompts: [],
    repoSettings: createRepoSettings(null),
    updateAgentSessionModel: () => {},
    loadCatalog: async () => CATALOG,
    ...hookOverrides,
  };
};

const createSelectedSessionSummary = ({
  runtimeKind,
  selectedModel,
}: {
  runtimeKind: RuntimeKind;
  selectedModel: AgentModelSelection;
}): AgentSessionSummary => ({
  externalSessionId: "external-1",
  runtimeKind,
  workingDirectory: "/repo",
  taskId: "task-1",
  role: "build",
  activityState: "idle",
  startedAt: "2026-02-20T10:00:00.000Z",
  selectedModel,
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
});

describe("useAgentStudioChatComposer", () => {
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

    try {
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
    } finally {
      await harness.unmount();
    }
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

  test("does not load the new-session catalog until the selected runtime is ready", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const expectedSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    } satisfies AgentModelSelection;
    const harness = createHookHarness(
      createBaseProps({
        repoReadinessState: "checking",
        repoSettings: createRepoSettings(expectedSelection),
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

      expect(loadCatalog).not.toHaveBeenCalled();
      expect(harness.getLatest().selectionForNewSession).toEqual(expectedSelection);
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

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("publishes agent colors from composer catalog before a session is started", async () => {
    const harness = createHookHarness(createBaseProps());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.agentProfileOptions.length > 0);

      const state = harness.getLatest();
      expect(state.agentAccentColorsByProfileId).toMatchObject({
        "spec-agent": "#f59e0b",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the selected session model while selected-session runtime data loads", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: null,
        selectedSessionIdentity: {
          externalSessionId: "external-1",
          workingDirectory: "/repo",
          runtimeKind: "opencode",
        },
        selectedSessionSummary: createSelectedSessionSummary({
          runtimeKind: "opencode",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-sonnet",
            profileId: "build-agent",
          },
        }),
        sessionRuntimeData: createSessionRuntimeData({ isLoadingModelCatalog: true }),
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSlashCommandsLoading === false);

      expect(loadCatalog).toHaveBeenCalledTimes(0);
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

  test("repairs a stale loaded-session model exactly once", async () => {
    const staleSelection = {
      runtimeKind: "opencode" as const,
      providerId: "missing",
      modelId: "missing-model",
    };
    const repairedSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };
    const repoDefaultSelection = { ...repairedSelection, variant: "", profileId: "" };
    const staleSession = createLoadedSession({
      externalSessionId: "stale-session",
      selectedModel: staleSelection,
    });
    const repairedSession = createLoadedSession({
      externalSessionId: "stale-session",
      selectedModel: repairedSelection,
    });
    const updateAgentSessionModel = mock(() => {});
    const baseOverrides = {
      repoSettings: createRepoSettings(repoDefaultSelection),
      sessionRuntimeData: createSessionRuntimeData({ modelCatalog: CATALOG }),
      updateAgentSessionModel,
    };
    const harness = createHookHarness(
      createBaseProps({
        ...baseOverrides,
        loadedSession: staleSession,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-sonnet");

      expect(harness.getLatest().selectedModelSelection).toEqual(repairedSelection);
      expect(harness.getLatest().isSelectedSessionModelSendable).toBe(false);
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
      expect(updateAgentSessionModel).toHaveBeenCalledWith(
        toAgentSessionIdentity(staleSession),
        repairedSelection,
      );

      await harness.update(
        createBaseProps({
          ...baseOverrides,
          loadedSession: repairedSession,
        }),
      );
      await harness.waitFor((state) => state.isSelectedSessionModelSendable);

      expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("uses selected session runtime capabilities while the full session object is still loading", async () => {
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: null,
        selectedSessionIdentity: {
          externalSessionId: "external-codex",
          workingDirectory: "/repo",
          runtimeKind: "codex",
        },
        selectedSessionSummary: createSelectedSessionSummary({
          runtimeKind: "codex",
          selectedModel: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "build-agent",
          },
        }),
        repoSettings: createRepoSettings(null, "opencode"),
        loadCatalog: async () => CODEX_CATALOG,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();

      expect(harness.getLatest().supportsSlashCommands).toBe(true);
      expect(harness.getLatest().supportsFileSearch).toBe(true);
      expect(harness.getLatest().supportsSkillReferences).toBe(true);
      expect(harness.getLatest().supportsSubagentReferences).toBe(false);
      expect(harness.getLatest().supportsProfiles).toBe(false);
    } finally {
      await harness.unmount();
    }
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
      expect(harness.getLatest().supportsProfiles).toBe(true);

      let results: AgentFileSearchResult[] = [];
      await harness.run(async (state) => {
        results = await state.searchFiles("src");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("loads repo subagents through the repo runtime before a session starts", async () => {
    const loadSubagents = mock(async () => SUBAGENT_CATALOG);
    const harness = createHookHarness(
      createBaseProps({
        loadSubagents,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.subagents.length === 1);

      expect(harness.getLatest().supportsSubagentReferences).toBe(true);
      expect(harness.getLatest().subagents).toEqual(SUBAGENT_CATALOG.subagents);
      expect(loadSubagents).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime readiness before searching repo files", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const harness = createHookHarness(
      createBaseProps({
        repoReadinessState: "checking",
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().supportsFileSearch).toBe(true);

      await expect(harness.getLatest().searchFiles("src")).rejects.toThrow(
        "File search is unavailable until the runtime is ready.",
      );
      expect(loadFileSearch).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("searches repo files through the selected Codex repo runtime before a session starts", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings(null, "codex"),
        loadCatalog: async () => CODEX_CATALOG,
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
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
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses selected-session identity for file search before the full session is loaded", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const selectedSessionIdentity = {
      externalSessionId: "selected-codex-session",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/codex-worktree",
    };
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: null,
        selectedSessionIdentity,
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();

      let results: AgentFileSearchResult[] = [];
      await harness.run(async (state) => {
        results = await state.searchFiles("src");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex-worktree",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses the loaded session runtime for file search", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const loadedSession = createLoadedSession({
      runtimeKind: "opencode",
      workingDirectory: "/repo/session-worktree",
    });
    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
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
        results = await state.searchFiles("");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/session-worktree",
        },
        "",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses the selected-session identity as the prompt-input runtime target", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const loadedSession = createLoadedSession({
      runtimeKind: "opencode",
      workingDirectory: "/repo/opencode-worktree",
    });
    const selectedSessionIdentity = {
      externalSessionId: "selected-codex-session",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/codex-worktree",
    };
    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        selectedSessionIdentity,
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().supportsSlashCommands).toBe(true);
      expect(harness.getLatest().supportsFileSearch).toBe(true);

      let results: AgentFileSearchResult[] = [];
      await harness.run(async (state) => {
        results = await state.searchFiles("src");
      });

      expect(results).toEqual(FILE_SEARCH_RESULTS);
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex-worktree",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses the loaded Codex session runtime and working directory for file search", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const loadedSession = createLoadedSession({
      runtimeKind: "codex",
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
      },
      workingDirectory: "/repo/codex-worktree",
    });
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings(null, "opencode"),
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ modelCatalog: CODEX_CATALOG }),
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
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
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex-worktree",
        },
        "",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loaded session runtime capabilities when that runtime is disabled", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const loadedSession = createLoadedSession({
      runtimeKind: "opencode",
      workingDirectory: "/repo/session-worktree",
    });
    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        availableRuntimeDefinitions: [],
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
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/session-worktree",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("queries runtime slash commands for stdio OpenCode sessions", async () => {
    const loadSlashCommands = mock(async () => ({
      commands: [{ id: "review", trigger: "review", title: "review", hints: [] }],
    }));
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: createLoadedSession({
          runtimeKind: "opencode",
          workingDirectory: "/repo/session-worktree",
        }),
        loadSlashCommands,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSlashCommandsLoading === false);

      expect(loadSlashCommands).toHaveBeenCalledTimes(1);
      expect(loadSlashCommands).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
      });
      expect(harness.getLatest().slashCommandsError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("merges runtime slash commands with reusable prompt commands", async () => {
    const loadSlashCommands = mock(async () => ({
      commands: [{ id: "native-review", trigger: "review", title: "Runtime review", hints: [] }],
    }));
    const harness = createHookHarness(
      createBaseProps({
        reusablePrompts: [
          {
            id: "prompt-1",
            name: "summarize",
            description: "Summarize context",
            content: "Summarize this:\n$ARGUMENTS",
          },
        ],
        loadSlashCommands,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSlashCommandsLoading === false);

      expect(harness.getLatest().supportsSlashCommands).toBe(true);
      expect(harness.getLatest().slashCommands.map((command) => command.id)).toEqual([
        "native-review",
        "reusable-prompt:prompt-1",
      ]);
      expect(harness.getLatest().slashCommands.at(1)?.source).toBe("custom");
    } finally {
      await harness.unmount();
    }
  });

  test("reserves compact while giving reusable prompts precedence over ordinary triggers", async () => {
    const loadSlashCommands = mock(async () => ({
      commands: [
        { id: "native-review", trigger: "review", title: "Runtime review", hints: [] },
        { id: "native-compact", trigger: "compact", title: "Runtime compact", hints: [] },
      ],
    }));
    const harness = createHookHarness(
      createBaseProps({
        reusablePrompts: [
          {
            id: "prompt-1",
            name: "Review",
            description: "Review context",
            content: "Review this:",
          },
        ],
        loadSlashCommands,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSlashCommandsLoading === false);

      expect(harness.getLatest().slashCommands.map((command) => command.id)).toEqual([
        "reusable-prompt:prompt-1",
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps reusable prompt commands available when runtime lacks native slash commands", async () => {
    const runtimeWithoutSlashCommands: RuntimeDescriptor = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
        promptInput: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.promptInput,
          supportsSlashCommands: false,
        },
      },
    };
    const loadSlashCommands = mock(async () => ({ commands: [] }));
    const harness = createHookHarness(
      createBaseProps({
        reusablePrompts: [
          {
            id: "prompt-1",
            name: "review",
            description: "Review context",
            content: "Review this.",
          },
        ],
        loadSlashCommands,
      }),
      { runtimeDefinitions: [runtimeWithoutSlashCommands] },
    );

    try {
      await harness.mount();

      expect(loadSlashCommands).not.toHaveBeenCalled();
      expect(harness.getLatest().supportsSlashCommands).toBe(true);
      expect(harness.getLatest().slashCommands).toEqual([
        {
          id: "reusable-prompt:prompt-1",
          trigger: "review",
          title: "review",
          description: "Review context",
          source: "custom",
          hints: [],
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("fails fast when a loaded session prompt-input runtime has no working directory", async () => {
    const loadFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: createLoadedSession({
          runtimeKind: "opencode",
          workingDirectory: "   ",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "default",
            profileId: "spec-agent",
          },
        }),
        loadFileSearch,
      }),
      {
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      },
    );

    await expect(harness.mount()).rejects.toThrow(
      "Session workingDirectory is required to read selected session runtime data.",
    );
    expect(loadFileSearch).not.toHaveBeenCalled();
  });

  test("propagates adapter errors when loaded session file search uses stdio OpenCode session", async () => {
    const loadFileSearch = mock(async () => {
      throw new Error("file search unavailable");
    });
    const harness = createHookHarness(
      createBaseProps({
        loadedSession: createLoadedSession({
          runtimeKind: "opencode",
          workingDirectory: "/repo/session-worktree",
        }),
        loadFileSearch,
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
      expect(loadFileSearch).toHaveBeenCalledTimes(1);
      expect(loadFileSearch).toHaveBeenCalledWith(
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/session-worktree",
        },
        "src",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("updates draft selections through model and variant handlers", async () => {
    const harness = createHookHarness(createBaseProps());

    try {
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
        harness.getLatest().handleSelectAgentProfile("build-agent");
      });

      const state = harness.getLatest();
      expect(state.selectedModelSelection).toEqual({
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

  test("updates loaded session model when catalog ids differ from provider model option values", async () => {
    const updateAgentSessionModel = mock(() => {});
    const loadedSession = createLoadedSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "medium",
      },
    });
    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({
          modelCatalog: CATALOG_WITH_TRANSPORT_MODEL_IDS,
        }),
        loadCatalog: async () => CATALOG_WITH_TRANSPORT_MODEL_IDS,
        updateAgentSessionModel,
      }),
    );

    try {
      await harness.mount();
      await harness.run(() => {
        harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
      });

      expect(updateAgentSessionModel).toHaveBeenCalledWith(toAgentSessionIdentity(loadedSession), {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "default",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("routes selection updates to loaded sessions via callback", async () => {
    const updateAgentSessionModel = mock(() => {});
    const loadedSession = createLoadedSession();

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        updateAgentSessionModel,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

      await harness.run(() => {
        harness.getLatest().handleSelectVariant("high");
      });

      expect(updateAgentSessionModel).toHaveBeenCalledWith(toAgentSessionIdentity(loadedSession), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("marks loaded session model unsendable when catalog cannot produce a replacement", async () => {
    const updateAgentSessionModel = mock(() => {});
    const loadedSession = createLoadedSession();

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ modelCatalog: EMPTY_CATALOG }),
        updateAgentSessionModel,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().selectedModelSelection).toBeNull();
      expect(harness.getLatest().isSelectedSessionModelSendable).toBe(false);
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("normalizes loaded session model and repairs the durable session model", async () => {
    const updateAgentSessionModel = mock(
      (..._args: Parameters<HookArgs["updateAgentSessionModel"]>) => {},
    );
    const loadedSession = createLoadedSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "missing",
        profileId: "spec-agent",
      },
    });

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ modelCatalog: CATALOG }),
        updateAgentSessionModel,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.selectedModelSelection?.variant === "default");

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec-agent",
      });
      expect(harness.getLatest().isSelectedSessionModelSendable).toBe(false);
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
      expect(updateAgentSessionModel).toHaveBeenCalledWith(toAgentSessionIdentity(loadedSession), {
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

  test("does not load the repo composer catalog while selected-session runtime data is loading", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const loadedSession = createLoadedSession();

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ isLoadingModelCatalog: true }),
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

  test("keeps loading while no catalog source is available for a loaded session", async () => {
    const loadedSession = createLoadedSession();

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ isLoadingModelCatalog: true }),
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
    const loadCatalog = mock(({ repoPath }: RepoRuntimeRef): Promise<AgentModelCatalog> => {
      if (repoPath === "/repo-a") {
        return repoALoad.promise;
      }
      if (repoPath === "/repo-b") {
        return repoBLoad.promise;
      }
      return Promise.reject(new Error(`Unexpected repo path: ${repoPath}`));
    });

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
      expect(loadCatalog.mock.calls[0]).toEqual([
        {
          repoPath: "/repo-a",
          runtimeKind: "opencode",
        },
      ]);
      expect(loadCatalog.mock.calls[1]).toEqual([
        {
          repoPath: "/repo-b",
          runtimeKind: "opencode",
        },
      ]);

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
    const loadCatalog = mock(async ({ repoPath }: RepoRuntimeRef): Promise<AgentModelCatalog> => {
      if (repoPath === "/repo-a") {
        return CATALOG;
      }
      if (repoPath === "/repo-b") {
        return ALTERNATE_CATALOG;
      }
      throw new Error(`Unexpected repo path: ${repoPath}`);
    });

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

  test("does not derive context usage from transcript messages", async () => {
    const loadedSession = createLoadedSession({
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
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ modelCatalog: CATALOG }),
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("prefers live session context usage before final assistant completion", async () => {
    const loadedSession = createLoadedSession({
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
        loadedSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toEqual({
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("clears context usage when the host live projection no longer provides it", async () => {
    const loadedSession = createLoadedSession({
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

    const harness = createHookHarness(createBaseProps({ loadedSession }));

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toEqual({
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });

      await harness.update(
        createBaseProps({
          loadedSession: {
            ...loadedSession,
            contextUsage: null,
          },
        }),
      );

      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("does not complete partial live usage from assistant message metadata", async () => {
    const loadedSession = createLoadedSession({
      status: "idle",
      selectedModel: null,
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
        loadedSession,
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);
      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
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
    const loadedSession = createLoadedSession({
      status: "idle",
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

    const harness = createHookHarness(
      createBaseProps({
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({
          modelCatalog: catalogWithSelectionFallback,
        }),
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toEqual({
        totalTokens: 31,
        contextWindow: 100_000,
        outputLimit: 4_096,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not synthesize token usage from transcript and selected-model metadata", async () => {
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
    const loadedSession = createLoadedSession({
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
        loadedSession,
        sessionRuntimeData: createSessionRuntimeData({ modelCatalog: catalogWithContextFallback }),
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("does not search older assistant messages for context usage", async () => {
    const loadedSession = createLoadedSession({
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
        loadedSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps live context usage unchanged when only session messages change", async () => {
    const contextUsage = {
      totalTokens: 44,
      contextWindow: 150_000,
      outputLimit: 4_096,
      providerId: "openai",
      modelId: "gpt-5",
    };
    const loadedSession = createLoadedSession({
      contextUsage,
      messages: [createAssistantMessage({ totalTokens: 12, contextWindow: 10_000 })],
    });
    const harness = createHookHarness(createBaseProps({ loadedSession }));

    try {
      await harness.mount();
      const previousUsage = harness.getLatest().selectedSessionContextUsage;

      await harness.update(
        createBaseProps({
          loadedSession: {
            ...loadedSession,
            messages: createSessionMessagesState(loadedSession.externalSessionId, [
              ...getSessionMessagesSlice(loadedSession, 0),
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
                  toolType: "generic" as const,
                  status: "running",
                },
              },
            ]),
            contextUsage,
          },
        }),
      );

      expect(harness.getLatest().selectedSessionContextUsage).toEqual(previousUsage);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps context usage absent when unrelated tail messages change", async () => {
    const loadedSession = createLoadedSession({
      contextUsage: null,
      messages: [
        createAssistantMessage({
          totalTokens: 21,
          contextWindow: 48_000,
        }),
      ],
    });
    const harness = createHookHarness(createBaseProps({ loadedSession }));

    try {
      await harness.mount();
      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();

      await harness.update(
        createBaseProps({
          loadedSession: {
            ...loadedSession,
            messages: createSessionMessagesState(loadedSession.externalSessionId, [
              ...getSessionMessagesSlice(loadedSession, 0),
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
                  toolType: "generic" as const,
                  status: "completed",
                },
              },
            ]),
            contextUsage: null,
          },
        }),
      );

      expect(harness.getLatest().selectedSessionContextUsage).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("uses live context from the selected session when identities share an external id", async () => {
    const externalSessionId = "shared-external-session";
    const firstMessages = createSessionMessagesState(externalSessionId, [
      createAssistantMessage({
        totalTokens: 21,
        contextWindow: 48_000,
      }),
    ]);
    const secondMessages = createSessionMessagesState(externalSessionId, [
      createAssistantMessage({
        totalTokens: 34,
        contextWindow: 96_000,
      }),
    ]);
    const firstSession = createLoadedSession({
      externalSessionId,
      workingDirectory: "/repo/worktree-a",
      messages: firstMessages,
      contextUsage: {
        totalTokens: 21,
        contextWindow: 48_000,
      },
    });
    const secondSession = createLoadedSession({
      externalSessionId,
      workingDirectory: "/repo/worktree-b",
      messages: secondMessages,
      contextUsage: {
        totalTokens: 34,
        contextWindow: 96_000,
      },
    });
    const harness = createHookHarness(createBaseProps({ loadedSession: firstSession }));

    try {
      await harness.mount();
      const firstUsage = harness.getLatest().selectedSessionContextUsage;
      expect(firstUsage).toEqual({
        totalTokens: 21,
        contextWindow: 48_000,
      });

      await harness.update(createBaseProps({ loadedSession: secondSession }));

      expect(harness.getLatest().selectedSessionContextUsage).toEqual({
        totalTokens: 34,
        contextWindow: 96_000,
      });
    } finally {
      await harness.unmount();
    }
  });
});
