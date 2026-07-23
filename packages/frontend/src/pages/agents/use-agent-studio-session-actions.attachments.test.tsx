import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { createSessionStartWorkflowRunner } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { hostClient } from "@/lib/host-client";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import {
  ChecksOperationsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createChecksStateContextValue,
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

enableReactActEnvironment();

const stageLocalAttachmentFileMock = mock(async (_args: unknown) => "/tmp/staged-brief.pdf");
const originalWorkspaceStageLocalAttachment = hostClient.workspaceStageLocalAttachment;

beforeEach(async () => {
  await clearAppQueryClient();
  stageLocalAttachmentFileMock.mockClear();
  hostClient.workspaceStageLocalAttachment = async (args) => ({
    path: await stageLocalAttachmentFileMock(args as never),
  });
});

afterEach(() => {
  hostClient.workspaceStageLocalAttachment = originalWorkspaceStageLocalAttachment;
});

type HookArgs = Parameters<typeof useAgentStudioSessionActions>[0];

const createSessionRuntimeData = (
  overrides: Partial<HookArgs["selectedSession"]["runtimeData"]> = {},
): HookArgs["selectedSession"]["runtimeData"] => ({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  error: null,
  ...overrides,
});

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
    workspaceId: "workspace-1",
    startAgentSession: async () => sessionIdentity("session-new"),
    sendAgentMessage: async () => {},
    ...overrides,
  });

const localSessionIdentity = (externalSessionId: string) =>
  toAgentSessionIdentity(createAgentSessionFixture({ externalSessionId }));

const createHookHarness = (initialProps: HookArgs) => {
  const checksStateContextValue = createChecksStateContextValue();
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
          RepoRuntimeHealthContext.Provider,
          {
            value: createRepoRuntimeHealthContextValue(),
          },
          createElement(
            ChecksStateContext.Provider,
            { value: checksStateContextValue },
            createElement(
              RuntimeDefinitionsContext.Provider,
              {
                value: createRuntimeDefinitionsContextValue({
                  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
                  loadRepoRuntimeCatalog: async () => ({
                    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
                    models: [],
                    defaultModelsByProvider: {},
                    profiles: [],
                  }),
                }),
              },
              children,
            ),
          ),
        ),
      ),
    );

  return createCoreHookHarness(useAgentStudioSessionActions, initialProps, { wrapper });
};

const createBaseArgs = (): HookArgs => {
  const loadedSession = createAgentSessionFixture({ externalSessionId: "session-existing" });
  const selectedSessionIdentity = localSessionIdentity("session-existing");

  return {
    activeWorkspaceId: "workspace-1",
    workspaceRepoPath: "/repo",
    taskId: "task-1",
    role: "spec",
    launchActionId: "spec_initial",
    selectedSession: {
      identity: selectedSessionIdentity,
      activityState: "running",
      selectedModel: loadedSession.selectedModel,
      loadedSession,
      runtimeData: createSessionRuntimeData(),
      runtimeReadiness: {
        state: "ready",
        message: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      transcriptState: { kind: "visible" },
      sessionAuxiliaryError: null,
    },
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    selectedModelDescriptor: {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default"],
      contextWindow: 200_000,
      outputLimit: 8_192,
      attachmentSupport: {
        image: false,
        audio: false,
        video: false,
        pdf: true,
      },
    },
    sessionsForTask: [],
    selectedTask: createTaskCardFixture(),
    isSelectedSessionModelSendable: true,
    agentStudioReady: true,
    isActiveTaskReady: true,
    selectionForNewSession: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec",
    },
    reusablePrompts: [],
    repoSettings: null,
    runSessionStartWorkflow: createRunSessionStartWorkflow(),
    sendAgentMessage: async () => {},
    humanRequestChangesTask: async () => {},
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
    scheduleQueryUpdate: () => {},
    selectAgentStudioSelection: () => {},
  };
};

const createAttachmentDraft = (
  segments: AgentChatComposerDraft["segments"],
): AgentChatComposerDraft => {
  const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
  return {
    segments,
    attachments: [
      createComposerAttachment(
        {
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
          file,
        },
        "attachment-1",
      ),
    ],
  };
};

describe("useAgentStudioSessionActions attachments", () => {
  test("stages browser attachments before sending them", async () => {
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      sendAgentMessage,
    });
    const draft = createAttachmentDraft([createTextSegment("please review")]);
    const attachmentFile = draft.attachments?.[0]?.file;
    if (!(attachmentFile instanceof File)) {
      throw new Error("Expected draft attachment file");
    }

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(stageLocalAttachmentFileMock).toHaveBeenCalledWith({
      name: "brief.pdf",
      mime: "application/pdf",
      base64Data: "cGRm",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "please review" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
          path: "/tmp/staged-brief.pdf",
        },
      },
    ]);

    await harness.unmount();
  });

  test("rejects slash-command drafts that also contain attachments", async () => {
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      sendAgentMessage,
    });
    const draft = createAttachmentDraft([
      createSlashCommandSegment(
        {
          id: "compact",
          trigger: "compact",
          title: "compact",
          hints: [],
        },
        "slash-1",
      ),
    ]);

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(false);
    });

    expect(stageLocalAttachmentFileMock).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("stages attachments even when the browser file exposes an original local path", async () => {
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      sendAgentMessage,
    });
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const attachment = createComposerAttachment(
      {
        name: "brief.pdf",
        kind: "pdf",
        mime: "application/pdf",
        path: "/Users/example/Desktop/brief.pdf",
        file,
      },
      "attachment-path-file",
    );
    const draft: AgentChatComposerDraft = {
      segments: [createTextSegment("please review")],
      attachments: [attachment],
    };

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(draft)).resolves.toBe(true);
    });

    expect(stageLocalAttachmentFileMock).toHaveBeenCalledWith({
      name: "brief.pdf",
      mime: "application/pdf",
      base64Data: "cGRm",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(localSessionIdentity("session-existing"), [
      { kind: "text", text: "please review" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-path-file",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
          path: "/tmp/staged-brief.pdf",
        },
      },
    ]);

    await harness.unmount();
  });
});
