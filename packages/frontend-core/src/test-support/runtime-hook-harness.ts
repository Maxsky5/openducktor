import {
  DEFAULT_AGENT_RUNTIMES,
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement, type ReactNode } from "react";
import {
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../app-state/app-state-contexts";
import type { ClientConnection } from "../connection/client-connection";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { getAvailableRuntimeDefinitions } from "../lib/agent-runtime";
import { settingsSnapshotQueryOptions } from "../queries/workspace";
import { HostRuntimeStatusContext } from "../sessions/session-contexts";
import type { HostRuntimeStatusContextValue } from "../types/session-slices";
import { createHookHarness } from "./react-hook-harness";
import {
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
} from "./shared-test-fixtures";
import { createTestClientConnection } from "./test-client-connection";

export const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor => {
  const workflowToolAliasesByCanonical: RuntimeDescriptor["workflowToolAliasesByCanonical"] = {};
  for (const toolName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
    const aliases = descriptor.workflowToolAliasesByCanonical[toolName];
    if (aliases) {
      workflowToolAliasesByCanonical[toolName] = [...aliases];
    }
  }

  return {
    ...descriptor,
    readOnlyRoleBlockedTools: [...descriptor.readOnlyRoleBlockedTools],
    workflowToolAliasesByCanonical,
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
  };
};

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
    isLoadingRuntimeSettings: overrides.isLoadingRuntimeSettings ?? false,
    runtimeSettingsError: overrides.runtimeSettingsError ?? null,
    hasRuntimeSettingsSnapshot: overrides.hasRuntimeSettingsSnapshot ?? true,
    refreshRuntimeSettings: overrides.refreshRuntimeSettings ?? (async () => {}),
    loadRepoRuntimeCatalog:
      overrides.loadRepoRuntimeCatalog ??
      (async () => {
        throw new Error("Test runtime catalog loader was not configured.");
      }),
    loadRepoRuntimeFileSearch: overrides.loadRepoRuntimeFileSearch ?? (async () => []),
  };
};

export type RuntimeHookHarnessOptions = {
  /** A connection that supplies host fakes. Its query client is the harness query client. */
  connection?: ClientConnection;
  /** A query client without a connection. The harness binds it to a new test connection. */
  queryClient?: QueryClient;
  runtimeDefinitionsContext?: RuntimeDefinitionsContextValue;
  runtimeDefinitionsContextRef?: { current: RuntimeDefinitionsContextValue };
  hostRuntimeStatusContext?: HostRuntimeStatusContextValue;
  hostRuntimeStatusContextRef?: { current: HostRuntimeStatusContextValue };
  seedSettingsSnapshot?: boolean;
  wrapper?: (props: PropsWithChildren) => ReactElement;
};

/** Renders a hook under a test connection and the runtime definition and status contexts. */
export const createRuntimeHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
  options?: RuntimeHookHarnessOptions,
) => {
  const runtimeDefinitionsContextRef = options?.runtimeDefinitionsContextRef ?? {
    current: options?.runtimeDefinitionsContext ?? createRuntimeDefinitionsContextValue(),
  };
  const hostRuntimeStatusContextRef = options?.hostRuntimeStatusContextRef ?? {
    current: options?.hostRuntimeStatusContext ?? createHostRuntimeStatusContextValue(),
  };
  if (options?.connection && options.queryClient) {
    throw new Error("Pass either connection or queryClient to the hook harness, not both.");
  }
  const connection =
    options?.connection ??
    createTestClientConnection(options?.queryClient ? { queryClient: options.queryClient } : {});
  if (options?.seedSettingsSnapshot !== false) {
    connection.queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
  }
  const renderOwnerProviders = (children: ReactNode): ReactNode =>
    options?.wrapper ? createElement(options.wrapper, null, children) : children;

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ClientConnectionProvider,
      { connection },
      createElement(
        HostRuntimeStatusContext.Provider,
        { value: hostRuntimeStatusContextRef.current },
        createElement(
          RuntimeDefinitionsContext.Provider,
          { value: runtimeDefinitionsContextRef.current },
          renderOwnerProviders(children),
        ),
      ),
    );

  return createHookHarness(useHook, initialProps, { wrapper });
};
