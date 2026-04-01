import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { hostClient } from "@/lib/host-client";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
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
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(RuntimeDefinitionsContext.Provider, {
          value: {
            runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
            loadRepoRuntimeCatalog: async () => ({
              runtime: OPENCODE_RUNTIME_DESCRIPTOR,
              models: [],
              defaultModelsByProvider: {},
              profiles: [],
            }),
            loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
            loadRepoRuntimeFileSearch: async () => [],
          },
          children,
        }),
      ),
    );

  return createCoreHookHarness(useAgentStudioSessionActions, initialProps, { wrapper });
};

const createBaseArgs = (): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  activeSession: createAgentSessionFixture({ sessionId: "session-existing" }),
  selectedModelSelection: null,
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
  agentStudioReady: true,
  isActiveTaskHydrated: true,
  selectionForNewSession: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "default",
    profileId: "spec",
  },
  repoSettings: null,
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  humanRequestChangesTask: async () => {},
  answerAgentQuestion: async () => {},
  updateQuery: () => {},
});

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
    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
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
});
