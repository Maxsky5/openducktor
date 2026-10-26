import type { TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  type ComponentProps,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { sonnerFeedback } from "@/lib/sonner-feedback";
import { toAgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksOperationsContext, ChecksStateContext } from "@/state/app-state-contexts";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentSessionTranscriptState } from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { createHookHarness as createSharedHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createRuntimeDefinitionsContextValue } from "@openducktor/frontend-core/test-support/runtime-hook-harness";
export {
  createDefaultRuntimeDefinitions,
  createRuntimeDefinitionsContextValue,
} from "@openducktor/frontend-core/test-support/runtime-hook-harness";
export { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import {
  type AgentSessionFixtureOverrides,
  createSettingsSnapshotFixture,
  createAgentSessionFixture as createSharedAgentSessionFixture,
  createDeferred as createSharedDeferred,
  createChecksStateFixture,
  createHostRuntimeStatusContextValue,
  createTaskCardFixture as createSharedTaskCardFixture,
  createTaskStoreCheckFixture as createSharedTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";

type RuntimeDefinitionsContextValue = NonNullable<
  ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"]
>;
type ChecksStateContextValue = NonNullable<
  ComponentProps<typeof ChecksStateContext.Provider>["value"]
>;

type HookHarnessOptions = {
  /** A connection that supplies host fakes. Its query client is the harness query client. */
  connection?: ClientConnection;
  /** A query client without a connection. The harness binds it to a new test connection. */
  queryClient?: QueryClient;
  runtimeDefinitionsContext?: RuntimeDefinitionsContextValue;
  runtimeDefinitionsContextRef?: { current: RuntimeDefinitionsContextValue };
  checksStateContext?: ChecksStateContextValue;
  checksStateContextRef?: { current: ChecksStateContextValue };
  hostRuntimeStatusContext?: HostRuntimeStatusContextValue;
  hostRuntimeStatusContextRef?: { current: HostRuntimeStatusContextValue };
  seedSettingsSnapshot?: boolean;
  wrapper?: (props: PropsWithChildren) => ReactElement;
};

const PAGE_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task 1",
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
};

type PageAgentSessionOverrides = AgentSessionFixtureOverrides;

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

export const createChecksStateContextValue = createChecksStateFixture;

export { createHostRuntimeStatusContextValue };

const TEST_CHECKS_OPERATIONS_CONTEXT = {
  refreshTaskStoreCheckForRepo: async () =>
    createSharedTaskStoreCheckFixture(
      {},
      { taskStorePath: "/repo/task-stores/workspace/database.sqlite" },
    ),
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
  const hostRuntimeStatusContextRef = options?.hostRuntimeStatusContextRef ?? {
    current: options?.hostRuntimeStatusContext ?? createHostRuntimeStatusContextValue(),
  };
  if (options?.connection && options.queryClient) {
    throw new Error("Pass either connection or queryClient to the hook harness, not both.");
  }
  // The desktop shows connection feedback with sonner, so toast assertions see it.
  const connection =
    options?.connection ??
    createTestClientConnection(
      options?.queryClient
        ? { queryClient: options.queryClient, feedback: sonnerFeedback }
        : { feedback: sonnerFeedback },
    );
  const queryClient = connection.queryClient;
  if (options?.seedSettingsSnapshot !== false) {
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
  }

  const renderQueryProvider = (children: ReactElement): ReactElement => {
    return createElement(ClientConnectionProvider, { connection }, children);
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
          HostRuntimeStatusContext.Provider,
          { value: hostRuntimeStatusContextRef.current },
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
