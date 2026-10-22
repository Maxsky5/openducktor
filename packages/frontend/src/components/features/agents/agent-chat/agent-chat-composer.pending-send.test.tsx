import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import type { AgentChatComposerModel, AgentChatPendingSendGroup } from "./agent-chat.types";
import {
  createSlashCommandSegment,
  type AgentChatComposerDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { AgentChatComposer, buildModel } from "./agent-chat-composer-test-helpers";
import { readPendingSendBlockedReason } from "./agent-chat-pending-send";

const REVIEW_COMMENTS: AgentChatPendingSendGroup = {
  key: "review_comments",
  count: 2,
  accessibleLabel: "2 pending review comments",
};

const IMAGE_ANNOTATIONS: AgentChatPendingSendGroup = {
  key: "browser_annotations",
  count: 1,
  accessibleLabel: "1 pending browser annotation",
  attachments: {
    items: [{ kind: "image", mime: "image/png", name: "annotation-1.png" }],
    removalHint: "Edit the annotations, and turn off Screenshot.",
  },
};

const TEXT_ONLY_ANNOTATIONS: AgentChatPendingSendGroup = {
  key: "browser_annotations",
  count: 1,
  accessibleLabel: "1 pending browser annotation",
};

const modelWith = (
  pendingSendItems: AgentChatPendingSendGroup[],
  imageSupport: boolean,
  onSend: AgentChatComposerModel["onSend"] = async () => true,
): AgentChatComposerModel => ({
  ...buildModel(),
  onSend,
  pendingSendItems,
  selectedModelDescriptor: {
    id: "openai/gpt-5",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-5",
    modelName: "GPT-5",
    variants: [],
    contextWindow: 200_000,
    outputLimit: 8_192,
    attachmentSupport: { image: imageSupport, audio: false, video: false, pdf: true },
  },
});

const sendButton = (): HTMLButtonElement => {
  const button = screen.getByRole("button", { name: "Send message" });
  if (!(button instanceof HTMLButtonElement)) throw new Error("Expected the Send button");
  return button;
};

const render = (element: ReactNode) => renderView(element, { wrapper: QueryProvider });

describe("AgentChatComposer pending send groups", () => {
  test("shows a separate count and label for review comments and annotations", () => {
    render(<AgentChatComposer model={modelWith([REVIEW_COMMENTS, TEXT_ONLY_ANNOTATIONS], true)} />);

    const badges = screen.getAllByTestId("agent-chat-send-pending-items-badge");
    expect(badges.map((badge) => [badge.getAttribute("aria-label"), badge.textContent])).toEqual([
      ["2 pending review comments", "2"],
      ["1 pending browser annotation", "1"],
    ]);
    expect(sendButton().disabled).toBe(false);
  });

  test("blocks Send with the normal image reason until no annotation sends a screenshot", async () => {
    const onSend = mock(async (_draft: AgentChatComposerDraft) => true);
    const view = render(
      <AgentChatComposer model={modelWith([REVIEW_COMMENTS, IMAGE_ANNOTATIONS], false, onSend)} />,
    );

    expect(sendButton().disabled).toBe(true);
    expect(screen.getByTestId("agent-chat-pending-items-blocked").textContent).toBe(
      "The selected model does not support image attachments. Edit the annotations, and turn off Screenshot.",
    );

    view.rerender(
      <AgentChatComposer
        model={modelWith([REVIEW_COMMENTS, TEXT_ONLY_ANNOTATIONS], false, onSend)}
      />,
    );
    expect(screen.queryByTestId("agent-chat-pending-items-blocked")).toBeNull();
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  test("allows image annotations when the selected model takes images", () => {
    render(<AgentChatComposer model={modelWith([IMAGE_ANNOTATIONS], true)} />);

    expect(sendButton().disabled).toBe(false);
    expect(screen.queryByTestId("agent-chat-pending-items-blocked")).toBeNull();
  });
});

describe("readPendingSendBlockedReason", () => {
  const imageSupport = { image: true, audio: false, video: false, pdf: false };
  const runtimeCommand = {
    segments: [
      createSlashCommandSegment({
        id: "review",
        trigger: "review",
        title: "Review",
        source: "command",
        hints: [],
      }),
    ],
  };
  const systemCommand = {
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

  test("rejects pending images for a runtime command or a runtime without attachments", () => {
    expect(
      readPendingSendBlockedReason({
        groups: [IMAGE_ANNOTATIONS],
        draft: runtimeCommand,
        supportsAttachments: true,
        attachmentSupport: imageSupport,
      }),
    ).toBe(
      "Slash commands cannot send attachments. Edit the annotations, and turn off Screenshot.",
    );
    expect(
      readPendingSendBlockedReason({
        groups: [IMAGE_ANNOTATIONS],
        draft: { segments: [] },
        supportsAttachments: false,
        attachmentSupport: imageSupport,
      }),
    ).toBe(
      "The selected runtime does not support attachments. Edit the annotations, and turn off Screenshot.",
    );
  });

  test("never blocks a system command, which does not carry the pending items", () => {
    const cases: Array<[AgentChatPendingSendGroup[], boolean, typeof imageSupport | null]> = [
      [[IMAGE_ANNOTATIONS], true, { ...imageSupport, image: false }],
      [[IMAGE_ANNOTATIONS], false, imageSupport],
    ];
    for (const [groups, supportsAttachments, attachmentSupport] of cases) {
      expect(
        readPendingSendBlockedReason({
          groups,
          draft: systemCommand,
          supportsAttachments,
          attachmentSupport,
        }),
      ).toBeNull();
    }
  });

  test("ignores system commands, empty groups, and groups without files", () => {
    const cases: Array<[AgentChatPendingSendGroup[], AgentChatComposerDraft]> = [
      [[IMAGE_ANNOTATIONS], systemCommand],
      [[{ ...IMAGE_ANNOTATIONS, count: 0 }], runtimeCommand],
      [[TEXT_ONLY_ANNOTATIONS, REVIEW_COMMENTS], runtimeCommand],
    ];
    for (const [groups, draft] of cases) {
      expect(
        readPendingSendBlockedReason({
          groups,
          draft,
          supportsAttachments: true,
          attachmentSupport: imageSupport,
        }),
      ).toBeNull();
    }
  });
});
