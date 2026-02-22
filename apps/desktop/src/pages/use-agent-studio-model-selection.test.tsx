import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  type AgentStudioModelSelectionState,
  useAgentStudioModelSelection,
} from "./use-agent-studio-model-selection";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

type HookArgs = Parameters<typeof useAgentStudioModelSelection>[0];
type HookState = AgentStudioModelSelectionState;

const CATALOG: AgentModelCatalog = {
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
  agents: [
    {
      name: "spec-agent",
      mode: "primary",
      hidden: false,
    },
    {
      name: "build-agent",
      mode: "primary",
      hidden: false,
    },
  ],
};

const createRepoSettings = (
  specDefault: RepoSettingsInput["agentDefaults"]["spec"] | null,
): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: "codex/",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  agentDefaults: {
    spec: specDefault,
    planner: null,
    build: null,
    qa: null,
  },
});

const createActiveSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4000",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: CATALOG,
  selectedModel: {
    providerId: "openai",
    modelId: "gpt-5",
    variant: "default",
    opencodeAgent: "spec-agent",
  },
  isLoadingModelCatalog: false,
  ...overrides,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioModelSelection(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, initialProps));
      await flush();
    });
  };

  const run = async (fn: () => Promise<void> | void): Promise<void> => {
    await act(async () => {
      await fn();
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const waitFor = async (
    predicate: (state: HookState) => boolean,
    timeoutMs = 500,
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const current = latest;
      if (current && predicate(current)) {
        return;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await flush();
      });
    }

    throw new Error("Timed out waiting for hook state");
  };

  const unmount = async (): Promise<void> => {
    if (!renderer) {
      return;
    }
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, getLatest, waitFor, unmount };
};

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  activeSession: null,
  role: "spec",
  repoSettings: null,
  updateAgentSessionModel: () => {},
  loadCatalog: async () => CATALOG,
  ...overrides,
});

describe("useAgentStudioModelSelection", () => {
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("uses repo role defaults when available", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "spec-agent",
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "build-agent",
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

    expect(updateAgentSessionModel).toHaveBeenCalledWith("session-1", {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
  });
});
