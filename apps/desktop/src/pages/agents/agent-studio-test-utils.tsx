import type { TaskCard } from "@openducktor/contracts";
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
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
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
  runtimeEndpoint: "http://localhost:4000",
  workingDirectory: "/repo",
};

const TEST_RUNTIME_DEFINITIONS_CONTEXT = {
  runtimeDefinitions: [],
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  refreshRuntimeDefinitions: async () => [],
  loadRepoRuntimeCatalog: async () => {
    throw new Error("Test runtime catalog loader was not configured.");
  },
  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
} satisfies ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

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
  refreshBeadsCheckForRepo: async () => ({
    beadsOk: true,
    beadsPath: "/repo/.beads",
    beadsError: null,
  }),
  refreshRepoRuntimeHealthForRepo: async () => ({}),
  clearActiveBeadsCheck: () => {},
  clearActiveRepoRuntimeHealth: () => {},
  setIsLoadingChecks: () => {},
  hasRuntimeCheck: () => false,
  hasCachedBeadsCheck: () => false,
  hasCachedRepoRuntimeHealth: () => false,
} satisfies ComponentProps<typeof ChecksOperationsContext.Provider>["value"];

export const createDeferred = createSharedDeferred;

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(PAGE_TASK_CARD_DEFAULTS, overrides);

export const createAgentSessionFixture = (
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState => createSharedAgentSessionFixture(PAGE_SESSION_DEFAULTS, overrides);

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
) => {
  const checksOperationsContext = {
    ...TEST_CHECKS_OPERATIONS_CONTEXT,
  };
  const runtimeDefinitionsContext = {
    ...TEST_RUNTIME_DEFINITIONS_CONTEXT,
    runtimeDefinitions: [...TEST_RUNTIME_DEFINITIONS_CONTEXT.runtimeDefinitions],
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      { value: checksOperationsContext },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(RuntimeDefinitionsContext.Provider, {
          value: runtimeDefinitionsContext,
          children,
        }),
      ),
    );

  return createSharedHookHarness(useHook, initialProps, { wrapper });
};
