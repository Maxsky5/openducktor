import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type TaskCard,
} from "@openducktor/contracts";
import {
  type ComponentProps,
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture as createSharedAgentSessionFixture,
  createBeadsCheckFixture as createSharedBeadsCheckFixture,
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type RuntimeDefinitionsContextValue = NonNullable<
  ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"]
>;

export const enableReactActEnvironment = (): void => {
  (globalThis as ReactActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
};

const PAGE_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task 1",
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
};

const PAGE_SESSION_DEFAULTS: Partial<AgentSessionState> = {
  repoPath: "/repo",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeRoute: { type: "local_http", endpoint: "http://localhost:4000" },
  workingDirectory: "/repo",
};

export const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor => ({
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
      hydratedEventTypes: [...descriptor.capabilities.history.hydratedEventTypes],
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

  return {
    runtimeDefinitions: overrides.runtimeDefinitions
      ? overrides.runtimeDefinitions.map(cloneRuntimeDescriptor)
      : defaultRuntimeDefinitions,
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
  refreshBeadsCheckForRepo: async () =>
    createSharedBeadsCheckFixture({}, { beadsPath: "/repo/.beads" }),
  refreshRepoRuntimeHealthForRepo: async () => ({}),
  clearActiveBeadsCheck: () => {},
  clearActiveRepoRuntimeHealth: () => {},
  setIsLoadingChecks: () => {},
  hasRuntimeCheck: () => false,
  hasCachedBeadsCheck: () => false,
  hasCachedRepoRuntimeHealth: () => false,
} satisfies ComponentProps<typeof ChecksOperationsContext.Provider>["value"];

export const createDeferred = createSharedDeferred;

export const createBeadsCheckFixture = createSharedBeadsCheckFixture;

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(PAGE_TASK_CARD_DEFAULTS, overrides);

export const createAgentSessionFixture = (
  overrides: Partial<AgentSessionState> & { runId?: string | null } = {},
): AgentSessionState => createSharedAgentSessionFixture(PAGE_SESSION_DEFAULTS, overrides);

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
  options?: {
    runtimeDefinitionsContext?: RuntimeDefinitionsContextValue;
    runtimeDefinitionsContextRef?: { current: RuntimeDefinitionsContextValue };
  },
) => {
  const checksOperationsContext = {
    ...TEST_CHECKS_OPERATIONS_CONTEXT,
  };
  const runtimeDefinitionsContextRef = options?.runtimeDefinitionsContextRef ?? {
    current: options?.runtimeDefinitionsContext ?? createRuntimeDefinitionsContextValue(),
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      { value: checksOperationsContext },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(
          RuntimeDefinitionsContext.Provider,
          { value: runtimeDefinitionsContextRef.current },
          children,
        ),
      ),
    );

  return createSharedHookHarness(useHook, initialProps, { wrapper });
};
