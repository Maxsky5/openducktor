import type { TaskCard } from "@openducktor/contracts";
import { type ComponentProps, createElement, type ReactElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
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

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
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

type HookRunner<State> = (state: State) => void | Promise<void>;

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
) => {
  let latest: State | null = null;
  let currentProps = initialProps;

  const Harness = ({ hookProps }: { hookProps: Props }): ReactElement | null => {
    latest = useHook(hookProps);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(
          ChecksOperationsContext.Provider,
          { value: TEST_CHECKS_OPERATIONS_CONTEXT },
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(
              RuntimeDefinitionsContext.Provider,
              { value: TEST_RUNTIME_DEFINITIONS_CONTEXT },
              createElement(Harness, { hookProps: currentProps }),
            ),
          ),
        ),
      );
      await flushMicrotasks();
    });
  };

  const update = async (nextProps: Props): Promise<void> => {
    currentProps = nextProps;
    await act(async () => {
      renderer?.update(
        createElement(
          ChecksOperationsContext.Provider,
          { value: TEST_CHECKS_OPERATIONS_CONTEXT },
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(
              RuntimeDefinitionsContext.Provider,
              { value: TEST_RUNTIME_DEFINITIONS_CONTEXT },
              createElement(Harness, { hookProps: currentProps }),
            ),
          ),
        ),
      );
      await flushMicrotasks();
    });
  };

  const run = async (fn: HookRunner<State>): Promise<void> => {
    await act(async () => {
      if (!latest) {
        throw new Error("Hook state unavailable");
      }
      await fn(latest);
      await flushMicrotasks();
    });
  };

  const getLatest = (): State => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const waitFor = async (
    predicate: (state: State) => boolean,
    timeoutMs = 500,
    intervalMs = 5,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (latest && predicate(latest)) {
        return;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        await flushMicrotasks();
      });
    }

    throw new Error("Timed out waiting for hook state");
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flushMicrotasks();
    });
  };

  return { mount, update, run, getLatest, waitFor, unmount };
};
