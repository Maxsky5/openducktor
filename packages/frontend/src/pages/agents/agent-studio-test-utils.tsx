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
  type ReactNode,
} from "react";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import { createQueryClient } from "@/lib/query-client";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import {
  ChecksOperationsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createSettingsSnapshotFixture,
  createAgentSessionFixture as createSharedAgentSessionFixture,
  createDeferred as createSharedDeferred,
  createRepoRuntimeHealthFixture as createSharedRepoRuntimeHealthFixture,
  createTaskCardFixture as createSharedTaskCardFixture,
  createTaskStoreCheckFixture as createSharedTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type RuntimeDefinitionsContextValue = NonNullable<
  ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"]
>;
type ChecksStateContextValue = NonNullable<
  ComponentProps<typeof ChecksStateContext.Provider>["value"]
>;
type RepoRuntimeHealthContextValue = NonNullable<
  ComponentProps<typeof RepoRuntimeHealthContext.Provider>["value"]
>;

type HookHarnessOptions = {
  queryClient?: QueryClient;
  runtimeDefinitionsContext?: RuntimeDefinitionsContextValue;
  runtimeDefinitionsContextRef?: { current: RuntimeDefinitionsContextValue };
  checksStateContext?: ChecksStateContextValue;
  checksStateContextRef?: { current: ChecksStateContextValue };
  repoRuntimeHealthContext?: RepoRuntimeHealthContextValue;
  repoRuntimeHealthContextRef?: { current: RepoRuntimeHealthContextValue };
  seedSettingsSnapshot?: boolean;
  wrapper?: (props: PropsWithChildren) => ReactElement;
};

export const enableReactActEnvironment = (): void => {
  (globalThis as ReactActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
};

const PAGE_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task 1",
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
};

type PageAgentSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
  runId?: string | null;
};

const PAGE_SESSION_DEFAULTS: PageAgentSessionOverrides = {
  startedAt: "2026-02-22T10:00:00.000Z",
  workingDirectory: "/repo",
};

type TranscriptStateFixtureInput =
  | AgentSessionTranscriptState
  | { kind: "failed"; message?: string };

export const createSelectedSessionTranscriptStateFixture = (
  transcriptState: TranscriptStateFixtureInput = { kind: "visible" },
): AgentSessionTranscriptState =>
  transcriptState.kind === "failed"
    ? {
        kind: "failed",
        message: transcriptState.message ?? "The selected conversation could not be loaded.",
      }
    : transcriptState;

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
    loadRepoRuntimeSkills: overrides.loadRepoRuntimeSkills ?? (async () => ({ skills: [] })),
    loadRepoRuntimeSubagents:
      overrides.loadRepoRuntimeSubagents ?? (async () => ({ subagents: [] })),
    loadRepoRuntimeFileSearch: overrides.loadRepoRuntimeFileSearch ?? (async () => []),
  };
};

export const createChecksStateContextValue = (
  overrides: Partial<ChecksStateContextValue> = {},
): ChecksStateContextValue => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  isLoadingChecks: false,
  refreshChecks: async () => undefined,
  ...overrides,
});

export const createRepoRuntimeHealthContextValue = (
  overrides: Partial<RepoRuntimeHealthContextValue> = {},
): RepoRuntimeHealthContextValue => {
  const runtimeHealthByRuntime = overrides.runtimeHealthByRuntime ?? {
    opencode: createSharedRepoRuntimeHealthFixture(),
  };

  return {
    runtimeHealthByRuntime,
    isLoadingRepoRuntimeHealth: false,
    refreshRepoRuntimeHealth: async () => runtimeHealthByRuntime,
    ...overrides,
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
  clearActiveTaskStoreCheck: () => {},
  setIsLoadingChecks: () => {},
  hasRuntimeCheck: () => false,
  hasCachedTaskStoreCheck: () => false,
} satisfies ComponentProps<typeof ChecksOperationsContext.Provider>["value"];

export const createDeferred = createSharedDeferred;

export const createTaskStoreCheckFixture = createSharedTaskStoreCheckFixture;

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(PAGE_TASK_CARD_DEFAULTS, overrides);

export const createAgentSessionFixture = (
  overrides: PageAgentSessionOverrides = {},
): AgentSessionState => createSharedAgentSessionFixture(PAGE_SESSION_DEFAULTS, overrides);

export const createAgentSessionSummaryFixture = (overrides: PageAgentSessionOverrides = {}) =>
  toAgentSessionSummary(createAgentSessionFixture(overrides));

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
  const checksStateContextRef = options?.checksStateContextRef ?? {
    current: options?.checksStateContext ?? createChecksStateContextValue(),
  };
  const repoRuntimeHealthContextRef = options?.repoRuntimeHealthContextRef ?? {
    current: options?.repoRuntimeHealthContext ?? createRepoRuntimeHealthContextValue(),
  };
  const queryClient = options?.queryClient ?? createQueryClient();
  if (options?.seedSettingsSnapshot !== false) {
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
  }

  const renderQueryProvider = (children: ReactElement): ReactElement => {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
  const renderOwnerProviders = (children: ReactNode): ReactNode => {
    if (!options?.wrapper) {
      return children;
    }

    return createElement(options.wrapper, null, children);
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      { value: checksOperationsContext },
      renderQueryProvider(
        createElement(
          RepoRuntimeHealthContext.Provider,
          { value: repoRuntimeHealthContextRef.current },
          createElement(
            ChecksStateContext.Provider,
            { value: checksStateContextRef.current },
            createElement(
              RuntimeDefinitionsContext.Provider,
              { value: runtimeDefinitionsContextRef.current },
              renderOwnerProviders(children),
            ),
          ),
        ),
      ),
    );

  return createSharedHookHarness(useHook, initialProps, { wrapper });
};
