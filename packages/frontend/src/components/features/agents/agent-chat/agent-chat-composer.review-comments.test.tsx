import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useReviewCommentComposer } from "@/features/agent-chat-composer/use-review-comment-composer";
import { createAgentStudioChatDraftPersistence } from "@/pages/agents/agent-studio-chat-draft";
import { createWorkspaceSessionChatDraftPersistence } from "@/pages/workspace-sessions/workspace-session-chat-draft";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatComposer } from "./agent-chat-composer";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createTextSegment,
  draftToSerializedText,
} from "./agent-chat-composer-draft";
import {
  buildModel,
  createMemoryStorage,
  typeIntoComposer,
} from "./agent-chat-composer-test-helpers";
import {
  resetAgentChatDraftStoreForTests,
  setAgentChatDraftAttachmentStagerForTests,
  setAgentChatDraftStorageForTests,
} from "./agent-chat-draft-store";

describe("AgentChatComposer review comments", () => {
  afterEach(() => {
    resetAgentChatDraftStoreForTests();
    resetInlineCommentDraftStoreForTests();
  });

  test.each([
    ["task", "accepted"],
    ["task", "rejected"],
    ["task", "rejected-newer"],
    ["workspace_session", "accepted"],
    ["workspace_session", "rejected"],
    ["workspace_session", "rejected-newer"],
  ] as const)(
    "settles %s comments and the original composer draft after %s",
    async (kind, outcome) => {
      const storage = createMemoryStorage();
      setAgentChatDraftStorageForTests(storage);
      setAgentChatDraftAttachmentStagerForTests(async () => "/tmp/brief.pdf");
      setInlineCommentDraftStorageForTests(storage);
      setInlineCommentDraftScheduleTaskForTests(() => () => {});
      const owner: InlineCommentOwner =
        kind === "task"
          ? { kind, workspaceId: "workspace-repo", taskId: "task-1" }
          : { kind, workspaceId: "workspace-repo", sessionId: "chat-1" };
      const ownerKey = toInlineCommentDraftOwnerKey(owner);
      if (!ownerKey) throw new Error("Expected comment owner");
      const persistence =
        kind === "task"
          ? createAgentStudioChatDraftPersistence({
              workspaceId: "workspace-repo",
              taskId: "task-1",
              session: {
                runtimeKind: "opencode",
                externalSessionId: "native-1",
                workingDirectory: "/repo",
              },
            })
          : createWorkspaceSessionChatDraftPersistence("workspace-repo", "chat-1");
      if (!persistence) throw new Error("Expected draft persistence");
      const originalDraft = {
        segments: [createTextSegment("Original text")],
        attachments: [
          createComposerAttachment(
            {
              name: "brief.pdf",
              kind: "pdf",
              mime: "application/pdf",
              file: new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
            },
            "pdf-1",
          ),
        ],
      };
      persistence.set(originalDraft);
      useInlineCommentDraftStore.getState().addDraft(ownerKey, {
        filePath: "src/a.ts",
        diffScope: "uncommitted",
        startLine: 2,
        endLine: 2,
        side: "new",
        text: "Review instruction",
        codeContext: [{ lineNumber: 2, text: "new code", isSelected: true }],
      });
      const acceptance = Promise.withResolvers<boolean>();
      const send = mock((_draft: AgentChatComposerDraft) => acceptance.promise);
      function CommentComposer({ selectedOwner }: { selectedOwner: InlineCommentOwner }) {
        const review = useReviewCommentComposer({ owner: selectedOwner, onSend: send });
        const selectedPersistence =
          selectedOwner === owner
            ? persistence
            : createWorkspaceSessionChatDraftPersistence("workspace-repo", "other-chat");
        if (!selectedPersistence) throw new Error("Expected selected draft persistence");
        const model: AgentChatComposerModel = {
          ...buildModel(),
          selectedModelDescriptor: {
            id: "openai/gpt-5",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5",
            modelName: "GPT-5",
            variants: [],
            contextWindow: 200_000,
            outputLimit: 8_192,
            attachmentSupport: { image: false, audio: false, video: false, pdf: true },
          },
          onSend: review.onSend,
          draftScope: { key: selectedPersistence.targetKey, persistence: selectedPersistence },
        };
        if (review.pendingSendItems) model.pendingSendItems = review.pendingSendItems;
        return <AgentChatComposer model={model} />;
      }
      const view = render(<CommentComposer selectedOwner={owner} />);
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      const sent = send.mock.calls[0]?.[0];
      if (!sent) throw new Error("Expected submitted draft");
      expect(draftToSerializedText(sent)).toContain("Original text");
      expect(draftToSerializedText(sent).split("## Git Diff Comments")).toHaveLength(2);
      expect(sent.attachments?.[0]?.id).toBe("pdf-1");
      if (outcome === "rejected-newer") typeIntoComposer(view.container, "Newer original edit");
      const otherOwner: InlineCommentOwner = {
        kind: "workspace_session",
        workspaceId: "workspace-repo",
        sessionId: "other-chat",
      };
      view.rerender(<CommentComposer selectedOwner={otherOwner} />);
      typeIntoComposer(view.container, "Other chat text");
      acceptance.resolve(outcome === "accepted");
      await waitFor(() =>
        expect(
          useInlineCommentDraftStore.getState().draftsByOwner[ownerKey]?.[0]?.status ?? "cleared",
        ).toBe(outcome === "accepted" ? "cleared" : "pending"),
      );
      expect(view.container.textContent).toContain("Other chat text");
      view.rerender(<CommentComposer selectedOwner={owner} />);
      const restoredText = draftToSerializedText(persistence.hydrate());
      expect(restoredText).toBe(
        {
          accepted: "",
          rejected: "Original text",
          "rejected-newer": "Newer original edit",
        }[outcome],
      );
      expect(restoredText).not.toContain("Git Diff Comments");
      if (outcome === "rejected") expect(persistence.hydrate().attachments?.[0]?.id).toBe("pdf-1");
      view.unmount();
    },
  );
});
