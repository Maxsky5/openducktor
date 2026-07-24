import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChat } from "./agent-chat";
import {
  buildModelSelection,
  buildSession,
  buildThreadTranscriptState,
  completeThreadModel,
} from "./agent-chat-test-fixtures";

const buildModel = () => ({
  chatSettings: createChatSettingsFixture(),
  thread: completeThreadModel({
    session: buildSession({
      status: "running" as const,
    }),
    isSessionWorking: true,
    transcriptState: buildThreadTranscriptState(),
    runtimeReadiness: {
      state: "ready" as const,
      message: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    },
    isInteractionEnabled: true,
    emptyState: null,
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    canSubmitQuestionAnswers: true,
    isSubmittingQuestionByRequestId: {},
    canReplyToApprovals: true,
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    onReplyApproval: async () => {},
    sessionAuxiliaryError: null,
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  }),
  composer: {
    taskId: "task-1",
    displayedSessionKey: "session-1",
    isInteractionEnabled: true,
    isReadOnly: false,
    readOnlyReason: null,
    busySendBlockedReason: null,
    pendingInlineCommentCount: 0,
    draftStateKey: "draft-1",
    draftPersistenceIdentity: null,
    onSend: async () => true,
    isSending: false,
    isStarting: false,
    isSessionWorking: false,
    isWaitingInput: false,
    waitingInputPlaceholder: null,
    isModelSelectionPending: false,
    selectedModelSelection: buildModelSelection(),
    selectedModelDescriptor: {
      id: "openai/gpt-5.3-codex",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5.3-codex",
      modelName: "GPT-5.3 Codex",
      variants: ["high"],
      contextWindow: 400_000,
      outputLimit: 128_000,
      attachmentSupport: {
        image: false,
        audio: false,
        video: false,
        pdf: true,
      },
    },
    isSelectionCatalogLoading: false,
    supportsAttachments: true,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    supportsSkillReferences: false,
    supportsSubagentReferences: false,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    skillCatalog: null,
    skills: [],
    skillsError: null,
    isSkillsLoading: false,
    subagentCatalog: null,
    subagents: [],
    subagentsError: null,
    isSubagentsLoading: false,
    searchFiles: async () => [],
    agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
    modelOptions: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
    modelGroups: [
      {
        label: "OpenAI",
        options: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
      },
    ],
    variantOptions: [{ value: "high", label: "high" }],
    onSelectAgent: () => {},
    onSelectModel: () => {},
    onSelectVariant: () => {},
    contextUsage: null,
    canStopSession: false,
    onStopSession: () => {},
    composerFormRef: createRef<HTMLFormElement>(),
    composerEditorRef: createRef<HTMLDivElement>(),
    onComposerEditorInput: () => {},
    scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
    syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
    accentColor: undefined,
  },
});

describe("AgentChat attachments", () => {
  test("shows the drag overlay and stages dropped files in the composer", async () => {
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const { getByTestId } = render(<AgentChat model={buildModel()} />);

    const dropTarget = getByTestId("agent-chat-drop-target");
    fireEvent.dragEnter(dropTarget, {
      dataTransfer: {
        types: ["Files"],
        files: [file],
      },
    });

    await screen.findByText("Drop files to attach them");

    fireEvent.drop(dropTarget, {
      dataTransfer: {
        types: ["Files"],
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.queryByText("Drop files to attach them")).toBeNull();
    });
    await screen.findByTitle("brief.pdf");
  });
});
