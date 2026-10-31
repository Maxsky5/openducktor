import { useSessionStartWorkflowRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-workflow-runner";
import {
  createAgentStudioStartupTestHost,
  type AgentStudioWorkflowFixture,
} from "./agent-studio-startup-test-host";
import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksOperationsContext, ChecksStateContext } from "@/state/app-state-contexts";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { withMockedToast } from "@/test-utils/mock-toast";
import { createHookHarness as createCoreHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createChecksStateContextValue,
  createHostRuntimeStatusContextValue,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionStartFlow } from "./session-start/use-agent-studio-session-start-flow";

enableReactActEnvironment();

type ProductionHookArgs = Parameters<typeof useAgentStudioSessionStartFlow>[0];
type HookArgs = Omit<ProductionHookArgs, "runSessionStartWorkflow"> & {
  workflow: AgentStudioWorkflowFixture;
};

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createWorkflowFixture = (
  overrides: Partial<AgentStudioWorkflowFixture> = {},
): AgentStudioWorkflowFixture => ({
  workspaceId: "workspace-1",
  startAgentSession: async () => sessionIdentity("session-new"),
  sendAgentMessage: async () => null,
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) => {
  let currentWorkflow = initialProps.workflow;
  const startupHost = createAgentStudioStartupTestHost(() => currentWorkflow);
  const checksStateContextValue = createChecksStateContextValue();
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      {
        value: {
          refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
        },
      },
      createElement(
        QueryProvider,
        { connection: startupHost.connection },
        createElement(
          HostRuntimeStatusContext.Provider,
          {
            value: createHostRuntimeStatusContextValue(),
          },
          createElement(
            ChecksStateContext.Provider,
            { value: checksStateContextValue },
            createElement(
              RuntimeDefinitionsContext.Provider,
              {
                value: {
                  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
                  isLoadingRuntimeDefinitions: false,
                  runtimeDefinitionsError: null,
                  isLoadingRuntimeSettings: false,
                  runtimeSettingsError: null,
                  hasRuntimeSettingsSnapshot: true,
                  refreshRuntimeSettings: async () => {},
                  refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
                  loadRepoRuntimeCatalog: async () => ({
                    models: {
                      status: "available" as const,
                      catalog: {
                        runtime: OPENCODE_RUNTIME_DESCRIPTOR,
                        models: [
                          {
                            id: "openai/gpt-5",
                            providerId: "openai",
                            providerName: "OpenAI",
                            modelId: "gpt-5",
                            modelName: "GPT-5",
                            variants: ["default"],
                            contextWindow: 200_000,
                            outputLimit: 8_192,
                          },
                        ],
                        defaultModelsByProvider: {
                          openai: "gpt-5",
                        },
                        profiles: [
                          {
                            name: "spec",
                            mode: "primary" as const,
                            hidden: false,
                          },
                        ],
                      },
                    },
                  }),
                  loadRepoRuntimeFileSearch: async () => [],
                },
              },
              createElement(startupHost.Providers, null, children),
            ),
          ),
        ),
      ),
    );

  const harness = createCoreHookHarness(
    (props: HookArgs) => {
      currentWorkflow = props.workflow;
      const runSessionStartWorkflow = useSessionStartWorkflowRunner({
        workspaceId: props.workspaceId,
        repoPath: props.workspaceRepoPath,
        notifications: props.workflow.notifications,
      });
      return useAgentStudioSessionStartFlow({ ...props, runSessionStartWorkflow });
    },
    initialProps,
    { wrapper },
  );
  return {
    ...harness,
    connection: startupHost.connection,
    unmount: async () => {
      await harness.unmount();
      await startupHost.dispose();
    },
  };
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceId: "workspace-1",
  workspaceRepoPath: "/repo",
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: false,
    toggleFavorite: () => {},
    retryRead: () => {},
    retryMutation: () => {},
  },
  taskId: "task-1",
  role: "spec",
  launchActionId: "spec_initial",
  selectedSessionIdentity: null,
  loadedSession: null,
  sessionsForTask: [],
  selectedTask: createTaskCardFixture(),
  canStartRole: () => true,
  isSessionWorking: false,
  selectionForNewSession: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "default",
    profileId: "spec",
  },
  repoSettings: null,
  workflow: createWorkflowFixture(),
  scheduleQueryUpdate: () => {},
  ...overrides,
});

describe("useAgentStudioSessionStartFlow kickoff failures", () => {
  test.each([true, false])(
    "keeps the saved session and startup feedback when kickoff fails=%s",
    async (fails) => {
      const startAgentSession = mock(async () => sessionIdentity("session-new"));
      const sendAgentMessage = mock(async () => {
        if (fails) throw new Error("kickoff failed");
        return null;
      });
      const scheduleQueryUpdate = mock(() => {});
      const harness = createHookHarness(
        createBaseArgs({
          scheduleQueryUpdate,
          workflow: createWorkflowFixture({
            startAgentSession,
            sendAgentMessage,
            notifications: {
              publishSessionStarted: () => {},
              publishSessionError: async () => false,
              markInAppFeedbackHandled: () => {},
              reportFailure: () => {},
            },
          }),
        }),
      );

      await harness.mount();
      await harness.run(async (state) => {
        void state.startLaunchKickoff();
      });
      await harness.waitFor(
        (state) =>
          state.sessionStartModal !== null &&
          state.sessionStartModal.isSelectionCatalogLoading === false &&
          state.sessionStartModal.isKickoffPromptLoading === false &&
          state.sessionStartModal.kickoffPromptError === null,
      );
      await withMockedToast(async ({ toastErrorMock }) => {
        await harness.run(async (state) => {
          state.sessionStartModal?.onSelectModelPair({
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
          });
          state.sessionStartModal?.onSelectRuntimeProfile("spec");
          state.sessionStartModal?.onSelectVariant("default");
          await state.sessionStartModal?.onConfirm({
            runInBackground: false,
            startMode: "fresh",
            sourceSessionOptionValue: null,
          });
        });

        expect(startAgentSession).toHaveBeenCalledTimes(1);
        expect(sendAgentMessage).toHaveBeenCalledTimes(1);
        if (fails) {
          expect(scheduleQueryUpdate).not.toHaveBeenCalled();
          expect(harness.connection.startupAttempts.getSnapshot()).toMatchObject([
            {
              status: { phase: "failed", confirmation: "current" },
              ownership: {
                state: "saved",
                target: { kind: "task", record: { externalSessionId: "session-new" } },
              },
              error: expect.stringContaining("kickoff failed"),
              recoveryActions: [{ kind: "retry_message" }],
            },
          ]);
        } else {
          expect(scheduleQueryUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ task: "task-1", session: "session-new" }),
          );
        }
        expect(toastErrorMock).not.toHaveBeenCalled();
      });

      await harness.unmount();
    },
  );
});
