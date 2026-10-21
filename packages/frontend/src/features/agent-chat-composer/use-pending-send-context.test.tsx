import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { act, type ReactNode } from "react";
import {
  type AgentChatComposerDraft,
  createSlashCommandSegment,
  createTextSegment,
  draftToSerializedText,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import {
  browserAnnotationStoreOf,
  toBrowserAnnotationOwnerKey,
} from "@/features/browser-annotations/browser-annotation-store";
import { buildCapture } from "@/features/browser-annotations/browser-annotation-test-support";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { usePendingSendContext } from "./use-pending-send-context";

const OWNERS: InlineCommentOwner[] = [
  { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
  { kind: "workspace_session", workspaceId: "workspace-1", sessionId: "chat-1" },
];

const keysFor = (owner: InlineCommentOwner) => {
  const comments = toInlineCommentDraftOwnerKey(owner);
  const annotations = toBrowserAnnotationOwnerKey(owner);
  if (!comments || !annotations) throw new Error("Expected owner keys");
  return { comments, annotations };
};

// Each test gets its own connection, so it starts with no inline comment drafts.
let connection: ClientConnection;
const wrapper = ({ children }: { children: ReactNode }) => (
  <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
);

const addPendingItems = (owner: InlineCommentOwner): void => {
  const keys = keysFor(owner);
  act(() => {
    connection.drafts.inlineComments.getState().addDraft(keys.comments, {
      filePath: "src/a.ts",
      diffScope: "uncommitted",
      startLine: 1,
      endLine: 1,
      side: "new",
      text: "Diff instruction",
      codeContext: [],
    });
    browserAnnotationStoreOf(connection).getState().addAnnotation(keys.annotations, {
      capture: buildCapture(),
      comment: "Annotation instruction",
      includeScreenshot: true,
    });
  });
};

const pendingCounts = (owner: InlineCommentOwner): [number, number] => {
  const keys = keysFor(owner);
  return [
    connection.drafts.inlineComments.getState().getDraftCount(keys.comments),
    browserAnnotationStoreOf(connection).getState().getPendingAnnotations(keys.annotations).length,
  ];
};

describe.each(OWNERS)("usePendingSendContext for $kind owners", (owner) => {
  beforeEach(() => {
    connection = createTestClientConnection({ scheduleTask: () => () => {} });
  });

  afterEach(async () => {
    await connection.dispose();
  });

  const renderContext = (onSend: (draft: AgentChatComposerDraft) => Promise<AgentChatSendResult>) =>
    renderHook(() => usePendingSendContext({ owner, workingDirectory: "/repo", onSend }), {
      wrapper,
    });

  test("shows separate counts and sends both groups after the user text", async () => {
    const sent: AgentChatComposerDraft[] = [];
    const view = renderContext(async (draft) => {
      sent.push(draft);
      return true;
    });
    expect(view.result.current.pendingSendItems).toEqual([]);

    addPendingItems(owner);
    expect(
      view.result.current.pendingSendItems.map(({ key, count, accessibleLabel }) => ({
        key,
        count,
        accessibleLabel,
      })),
    ).toEqual([
      { key: "review_comments", count: 1, accessibleLabel: "1 pending review comment" },
      { key: "browser_annotations", count: 1, accessibleLabel: "1 pending browser annotation" },
    ]);

    await act(async () => {
      expect(
        await view.result.current.onSend({ segments: [createTextSegment("User text")] }, "default"),
      ).toBe(true);
    });

    const text = draftToSerializedText(sent[0] ?? { segments: [] });
    const commentsAt = text.indexOf("## Git Diff Comments");
    const annotationsAt = text.indexOf("<browser_annotations>");
    expect(text.startsWith("User text\n\n")).toBe(true);
    expect(commentsAt).toBeGreaterThan(0);
    expect(annotationsAt).toBeGreaterThan(commentsAt);
    expect(sent[0]?.attachments?.map((attachment) => attachment.name)).toEqual([
      "annotation-1.png",
    ]);
    expect(pendingCounts(owner)).toEqual([0, 0]);
    expect(view.result.current.pendingSendItems).toEqual([]);
    view.unmount();
  });

  test("restores both groups when the runtime rejects the message", async () => {
    const view = renderContext(async () => false);
    addPendingItems(owner);

    await act(async () => {
      expect(
        await view.result.current.onSend({ segments: [createTextSegment("Retry")] }, "default"),
      ).toBe(false);
    });

    expect(pendingCounts(owner)).toEqual([1, 1]);
    expect(view.result.current.pendingSendItems.map((group) => group.count)).toEqual([1, 1]);
    view.unmount();
  });

  test("locks both groups while the send runs and clears them once on acceptance", async () => {
    const acceptance = Promise.withResolvers<boolean>();
    const view = renderContext(() => acceptance.promise);
    addPendingItems(owner);

    let result!: Promise<AgentChatSendResult>;
    act(() => {
      result = view.result.current.onSend({ segments: [createTextSegment("Send")] }, "default");
    });
    expect(view.result.current.pendingSendItems).toEqual([]);
    addPendingItems(owner);
    expect(view.result.current.pendingSendItems.map((group) => group.count)).toEqual([1, 1]);

    await act(async () => {
      acceptance.resolve(true);
      expect(await result).toBe(true);
    });
    expect(pendingCounts(owner)).toEqual([1, 1]);
    view.unmount();
  });

  test("keeps both groups pending for a system slash command", async () => {
    const sent: AgentChatComposerDraft[] = [];
    const view = renderContext(async (draft) => {
      sent.push(draft);
      return true;
    });
    addPendingItems(owner);
    const draft = {
      segments: [
        createSlashCommandSegment({
          id: "system:compact",
          trigger: "compact",
          title: "Compact",
          source: "system",
          hints: [],
        }),
      ],
    };

    await act(async () => {
      expect(await view.result.current.onSend(draft, "default")).toBe(true);
    });

    expect(sent).toEqual([draft]);
    expect(pendingCounts(owner)).toEqual([1, 1]);
    view.unmount();
  });
});
