import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type TaskCard,
} from "@openducktor/contracts";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type ComponentProps,
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { SelectedAgentSessionViewLifecycle } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture as createSharedAgentSessionFixture,
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
  createTaskStoreCheckFixture as createSharedTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type RuntimeDefinitionsContextValue = NonNullable<
  ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"]
>;

type HookHarnessOptions = {
  queryClient?: QueryClient;
  runtimeDefinitionsContext?: RuntimeDefinitionsContextValue;
  runtimeDefinitionsContextRef?: { current: RuntimeDefinitionsContextValue };
};

export const enableReactActEnvironment = (): void => {
  (globalThis as ReactActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
};

const PAGE_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task 1",
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
};

const PAGE_SESSION_DEFAULTS: Partial<AgentSessionState> = {
  startedAt: "2026-02-22T10:00:00.000Z",
  workingDirectory: "/repo",
};

export const createSelectedSessionLifecycleFixture = (
  overrides: Partial<SelectedAgentSessionViewLifecycle> = {},
): SelectedAgentSessionViewLifecycle => ({
  externalSessionId: "session-1",
  phase: "ready",
  canRenderHistory: true,
  historyRequest: "none",
  ...overrides,
});

const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor => ({
  ...descriptor,
  readOnlyRoleBlockedTools: [...descriptor.readOnlyRoleBlockedTools],
  workflowToolAliasesByCanonical: Object.fromEntries(
    Object.entries(descriptor.workflowToolAliasesByCanonical).map(([toolName, aliases]) => [
      toolName,
      aliases ? [...aliases] : aliases,
    ]),
  ) as RuntimeDescriptor["workflowToolAliasesByCanonical"],
  capabilities: {
    ...descriptor.capabilities,
    workflow: {
      ...descriptor.capabilities.workflow,
      supportedScopes: [...descriptor.capabilities.workflow.supportedScopes],
    },
    sessionLifecycle: {
      ...descriptor.capabilities.sessionLifecycle,
      supportedStartModes: [...descriptor.capabilities.sessionLifecycle.supportedStartModes],
      forkTargets: [...descriptor.capabilities.sessionLifecycle.forkTargets],
    },
    history: {
      ...descriptor.capabilities.history,
      limitations: [...descriptor.capabilities.history.limitations],
    },
    approvals: {
      ...descriptor.capabilities.approvals,
      supportedRequestTypes: [...descriptor.capabilities.approvals.supportedRequestTypes],
      supportedReplyOutcomes: [...descriptor.capabilities.approvals.supportedReplyOutcomes],
      pendingVisibility: [...descriptor.capabilities.approvals.pendingVisibility],
    },
    structuredInput: {
      ...descriptor.capabilities.structuredInput,
      supportedAnswerModes: [...descriptor.capabilities.structuredInput.supportedAnswerModes],
      pendingVisibility: [...descriptor.capabilities.structuredInput.pendingVisibility],
    },
    promptInput: {
      ...descriptor.capabilities.promptInput,
      supportedParts: [...descriptor.capabilities.promptInput.supportedParts],
    },
    optionalSurfaces: {
      ...descriptor.capabilities.optionalSurfaces,
      supportedSubagentExecutionModes: [
        ...descriptor.capabilities.optionalSurfaces.supportedSubagentExecutionModes,
      ],
    },
  },
});

export const createDefaultRuntimeDefinitions = (): RuntimeDescriptor[] => [
  cloneRuntimeDescriptor(OPENCODE_RUNTIME_DESCRIPTOR),
];

export const createRuntimeDefinitionsContextValue = (
  overrides: Partial<RuntimeDefinitionsContextValue> = {},
): RuntimeDefinitionsContextValue => {
  const defaultRuntimeDefinitions = createDefaultRuntimeDefinitions();
  const runtimeDefinitions = overrides.runtimeDefinitions
    ? overrides.runtimeDefinitions.map(cloneRuntimeDescriptor)
    : defaultRuntimeDefinitions;
  const agentRuntimes = overrides.agentRuntimes ?? DEFAULT_AGENT_RUNTIMES;

  return {
    runtimeDefinitions,
    agentRuntimes,
    availableRuntimeDefinitions:
      overrides.availableRuntimeDefinitions ??
      getAvailableRuntimeDefinitions({ runtimeDefinitions, agentRuntimes }),
    isLoadingRuntimeDefinitions: overrides.isLoadingRuntimeDefinitions ?? false,
    runtimeDefinitionsError: overrides.runtimeDefinitionsError ?? null,
    refreshRuntimeDefinitions:
      overrides.refreshRuntimeDefinitions ?? (async () => createDefaultRuntimeDefinitions()),
    loadRepoRuntimeCatalog:
      overrides.loadRepoRuntimeCatalog ??
      (async () => {
        throw new Error("Test runtime catalog loader was not configured.");
      }),
    loadRepoRuntimeSlashCommands:
      overrides.loadRepoRuntimeSlashCommands ?? (async () => ({ commands: [] })),
    loadRepoRuntimeFileSearch: overrides.loadRepoRuntimeFileSearch ?? (async () => []),
  };
};

const TEST_CHECKS_OPERATIONS_CONTEXT = {
  refreshRuntimeCheck: async () => ({
    gitOk: true,
    gitVersion: null,
    ghOk: true,
    ghVersion: null,
    ghAuthOk: true,
    ghAuthLogin: null,
    ghAuthError: null,
    runtimes: [],
    errors: [],
  }),
  refreshTaskStoreCheckForRepo: async () =>
    createSharedTaskStoreCheckFixture(
      {},
      { taskStorePath: "/repo/task-stores/workspace/database.sqlite" },
    ),
  refreshRepoRuntimeHealthForRepo: async () => ({}),
  clearActiveTaskStoreCheck: () => {},
  clearActiveRepoRuntimeHealth: () => {},
  setIsLoadingChecks: () => {},
  hasRuntimeCheck: () => false,
  hasCachedTaskStoreCheck: () => false,
  hasCachedRepoRuntimeHealth: () => false,
} satisfies ComponentProps<typeof ChecksOperationsContext.Provider>["value"];

export const createDeferred = createSharedDeferred;

export const createTaskStoreCheckFixture = createSharedTaskStoreCheckFixture;

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(PAGE_TASK_CARD_DEFAULTS, overrides);

export const createAgentSessionFixture = (
  overrides: Partial<AgentSessionState> & { runId?: string | null } = {},
): AgentSessionState => createSharedAgentSessionFixture(PAGE_SESSION_DEFAULTS, overrides);

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
  options?: HookHarnessOptions,
) => {
  const checksOperationsContext = {
    ...TEST_CHECKS_OPERATIONS_CONTEXT,
  };
  const runtimeDefinitionsContextRef = options?.runtimeDefinitionsContextRef ?? {
    current: options?.runtimeDefinitionsContext ?? createRuntimeDefinitionsContextValue(),
  };

  const renderQueryProvider = (children: ReactElement): ReactElement => {
    if (options?.queryClient) {
      return createElement(QueryClientProvider, { client: options.queryClient }, children);
    }

    return createElement(QueryProvider, { useIsolatedClient: true }, children);
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      { value: checksOperationsContext },
      renderQueryProvider(
        createElement(
          RuntimeDefinitionsContext.Provider,
          { value: runtimeDefinitionsContextRef.current },
          children,
        ),
      ),
    );

  return createSharedHookHarness(useHook, initialProps, { wrapper });
};
