import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { createSessionStartWorkflowRunner } from "@/features/session-start";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const toastErrorMock = mock(() => {});

type UseAgentStudioSessionStartFlowHook =
  typeof import("./session-start/use-agent-studio-session-start-flow")["useAgentStudioSessionStartFlow"];

let useAgentStudioSessionStartFlow: UseAgentStudioSessionStartFlowHook;

type HookArgs = Parameters<UseAgentStudioSessionStartFlowHook>[0];

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createRunSessionStartWorkflow = (
  overrides: Partial<Parameters<typeof createSessionStartWorkflowRunner>[0]> = {},
) =>
  createSessionStartWorkflowRunner({
    queryClient: new QueryClient(),
    workspaceId: null,
    startAgentSession: async () => sessionIdentity("session-new"),
    sendAgentMessage: async () => {},
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      {
        value: {
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
          refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
          clearActiveTaskStoreCheck: () => {},
          setIsLoadingChecks: () => {},
          hasRuntimeCheck: () => false,
          hasCachedTaskStoreCheck: () => false,
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(
          RuntimeDefinitionsContext.Provider,
          {
            value: {
              runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
              availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
              agentRuntimes: DEFAULT_AGENT_RUNTIMES,
              isLoadingRuntimeDefinitions: false,
              runtimeDefinitionsError: null,
              refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
              loadRepoRuntimeCatalog: async () => ({
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
              }),
              loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
              loadRepoRuntimeSkills: async () => ({ skills: [] }),
              loadRepoRuntimeFileSearch: async () => [],
            },
          },
          children,
        ),
      ),
    );

  return createCoreHookHarness(useAgentStudioSessionStartFlow, initialProps, { wrapper });
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceId: null,
  workspaceRepoPath: null,
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
  runSessionStartWorkflow: createRunSessionStartWorkflow(),
  humanRequestChangesTask: async () => {},
  updateQuery: () => {},
  ...overrides,
});

beforeEach(async () => {
  mock.module("sonner", () => ({
    toast: {
      error: toastErrorMock,
      success: () => {},
      loading: () => "",
      dismiss: () => {},
    },
  }));
  ({ useAgentStudioSessionStartFlow } = await import(
    "./session-start/use-agent-studio-session-start-flow"
  ));
});

afterEach(async () => {
  await restoreMockedModules([["sonner", () => import("sonner")]]);
});

beforeEach(() => {
  toastErrorMock.mockClear();
});

describe("useAgentStudioSessionStartFlow kickoff failures", () => {
  test("keeps the started session and shows a toast when kickoff send fails", async () => {
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const sendAgentMessage = mock(async () => {
      throw new Error("kickoff failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        runSessionStartWorkflow: createRunSessionStartWorkflow({
          startAgentSession,
          sendAgentMessage,
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
        state.sessionStartModal.isSelectionCatalogLoading === false,
    );
    await harness.run(async (state) => {
      state.sessionStartModal?.onSelectModel("openai/gpt-5");
      state.sessionStartModal?.onSelectAgent("spec");
      state.sessionStartModal?.onSelectVariant("default");
      await state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "fresh",
        sourceSessionOptionValue: null,
      });
    });

    expect(startAgentSession).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Session started, but the kickoff prompt failed to send.",
      {
        description: "kickoff failed",
      },
    );

    await harness.unmount();
  });
});
