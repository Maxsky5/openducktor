import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentMessageQueueAction } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createTextSegment,
} from "../../drafts/agent-chat-composer-draft";
import type { AttachmentStager } from "../../platform/device-file";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createAgentMessageQueuesStore } from "../agent-message-queues-store";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
} from "../../test-support/shared-test-fixtures";
import type { AgentChatSendResult } from "./agent-chat-send-result";
import { useAsyncActivityTracker } from "../../lib/use-async-activity-tracker";
import type {
  AgentChatMessage,
  AgentMessageSendOptions,
  AgentSessionIdentity,
} from "../../types/agent-orchestrator";
import { useAgentChatSendForTarget } from "../../test-support/agent-chat-send-fixture";
import { AgentChatSendProviders } from "../../test-support/agent-chat-send-providers";
import { createAgentMessageQueueSnapshot } from "../../test-support/agent-message-send-fixture";
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";
import { createDeferred } from "../../test-support/shared-test-fixtures";
import type { AgentChatResolvedTarget, AgentChatSendTarget } from "./use-agent-chat-send";

const SESSION: AgentSessionIdentity = {
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const NO_FILES = { image: false, audio: false, video: false, pdf: false };

const PDF_MODEL: AgentModelCatalog["models"][number] = {
  id: "openai/gpt-5",
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  variants: [],
  attachmentSupport: { ...NO_FILES, pdf: true },
};

const MODEL_CATALOG: AgentModelCatalog = { models: [PDF_MODEL], defaultModelsByProvider: {} };

const textDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

const attachmentDraft = (): AgentChatComposerDraft => ({
  segments: [createTextSegment("please review")],
  attachments: [
    createComposerAttachment(
      {
        name: "brief.pdf",
        kind: "pdf",
        mime: "application/pdf",
        file: new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
      },
      "attachment-1",
    ),
  ],
});

/** One queued follow-up with the submission ID "submission-follow-up". */
const queuedFollowUp = () =>
  createAgentMessageQueueSnapshot({
    target: { repoPath: "/repo", ...SESSION, sessionScope: { kind: "repository" } },
    texts: ["follow-up"],
  });

const userMessageWithModel = (modelId: string): AgentChatMessage => ({
  id: `user-${modelId}`,
  role: "user",
  content: "Start",
  timestamp: "2026-10-08T10:00:00.000Z",
  meta: { kind: "user", state: "read", providerId: "openai", modelId },
});

type TargetProps = Pick<AgentChatSendTarget, "resolve" | "onFailure"> & {
  canSend: boolean;
};

type HookProps = Parameters<typeof useAgentChatSendForTarget>[1] & { target: TargetProps };

/** A chat whose target is the test session, so the shared send rules run alone. */
const useTestChatSend = ({ target: { canSend, ...target }, ...props }: HookProps) => {
  const activity = useAsyncActivityTracker();
  return useAgentChatSendForTarget(
    { ...target, capture: () => () => true, activity, activityKey: "chat", canSend: () => canSend },
    props,
  );
};

const existingSession = async (): Promise<AgentChatResolvedTarget> => ({
  identity: SESSION,
});

const stageBriefOnHost: AttachmentStager = async () => "/staged/brief.pdf";

const renderChatSend = (
  initialProps: Partial<HookProps> = {},
  {
    runtimeVersion = "2.0.24",
    stageAttachment,
  }: { runtimeVersion?: string | null; stageAttachment?: AttachmentStager } = {},
) => {
  const manageAgentMessageQueue = mock(
    async (_session: AgentSessionIdentity, _action: AgentMessageQueueAction) => {},
  );
  const sendAgentMessage = mock(
    async (_session: AgentSessionIdentity, _parts: unknown[], _options?: AgentMessageSendOptions) =>
      null,
  );
  const operations = createAgentOperationsFixture({ manageAgentMessageQueue, sendAgentMessage });
  const runtimeStatus = createHostRuntimeStatusContextValue({
    statusByKind: {
      opencode: createHostRuntimeStatusFixture({ kind: "opencode", version: runtimeVersion }),
    },
  });
  const queues = createAgentMessageQueuesStore();
  const connection = createTestClientConnection(stageAttachment ? { stageAttachment } : {});
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <AgentChatSendProviders operations={operations} runtimeStatus={runtimeStatus} queues={queues}>
        {children}
      </AgentChatSendProviders>
    </ClientConnectionProvider>
  );
  const view = renderHook((props: HookProps) => useTestChatSend(props), {
    wrapper,
    initialProps: {
      identity: SESSION,
      modelCatalog: MODEL_CATALOG,
      selectedModelDescriptor: PDF_MODEL,
      target: { canSend: true, resolve: existingSession },
      ...initialProps,
    },
  });
  return { view, queues, manageAgentMessageQueue, sendAgentMessage };
};

describe("useAgentChatSend", () => {
  test("reads the queue of the session and follows queue updates", () => {
    const { view, queues } = renderChatSend();
    try {
      expect(view.result.current.messageQueue?.queue).toBeNull();
      act(() => queues.apply(queuedFollowUp()));
      expect(view.result.current.messageQueue?.queue).toEqual(queuedFollowUp());
    } finally {
      view.unmount();
    }
  });

  test("sends queue actions and saves an edit with the content rules of a new message", async () => {
    const { view, queues, manageAgentMessageQueue } = renderChatSend();
    try {
      act(() => queues.apply(queuedFollowUp()));
      const messageQueue = view.result.current.messageQueue;
      if (!messageQueue) throw new Error("Expected a queue model for the session.");
      await messageQueue.onAction({ kind: "steer", submissionId: "submission-follow-up" });
      const edit = { submissionId: "submission-follow-up", editId: "edit-1" };
      await messageQueue.onSaveEdit(edit, textDraft("Edited"));
      await expect(messageQueue.onSaveEdit(edit, textDraft("   "))).rejects.toThrow(
        "The edited message is empty",
      );

      expect(manageAgentMessageQueue.mock.calls).toEqual([
        [SESSION, { kind: "steer", submissionId: "submission-follow-up" }],
        [
          SESSION,
          {
            kind: "save_edit",
            submissionId: "submission-follow-up",
            editId: "edit-1",
            parts: [{ kind: "text", text: "Edited" }],
          },
        ],
      ]);
    } finally {
      view.unmount();
    }
  });

  test("checks an edited attachment against the current session model", async () => {
    const captured = renderChatSend({}, { stageAttachment: stageBriefOnHost });
    const textOnly = renderChatSend(
      {
        modelCatalog: { ...MODEL_CATALOG, models: [{ ...PDF_MODEL, attachmentSupport: NO_FILES }] },
        selectedModelDescriptor: { ...PDF_MODEL, attachmentSupport: NO_FILES },
      },
      { stageAttachment: stageBriefOnHost },
    );
    try {
      act(() => captured.queues.apply(queuedFollowUp()));
      act(() => textOnly.queues.apply(queuedFollowUp()));
      const edit = { submissionId: "submission-follow-up", editId: "edit-1" };

      await captured.view.result.current.messageQueue?.onSaveEdit(edit, attachmentDraft());
      await expect(
        textOnly.view.result.current.messageQueue?.onSaveEdit(edit, attachmentDraft()),
      ).rejects.toThrow("The edited message is empty");

      expect(captured.manageAgentMessageQueue.mock.calls[0]?.[1]).toMatchObject({
        kind: "save_edit",
        parts: [
          { kind: "text", text: "please review" },
          {
            kind: "attachment",
            attachment: expect.objectContaining({ path: "/staged/brief.pdf" }),
          },
        ],
      });
      expect(textOnly.manageAgentMessageQueue).not.toHaveBeenCalled();
    } finally {
      captured.view.unmount();
      textOnly.view.unmount();
    }
  });

  test("allows steering only on a runtime version that supports it", () => {
    const supported = renderChatSend();
    const outdated = renderChatSend({}, { runtimeVersion: "1.0.0" });
    const unknown = renderChatSend({}, { runtimeVersion: null });
    const missingDescriptor = renderChatSend({ runtimeDescriptor: null });
    try {
      expect(supported.view.result.current.steerBlockedReason).toBeNull();
      expect(outdated.view.result.current.steerBlockedReason).toBe(
        "OpenCode 1.0.0 cannot steer running work. Update OpenCode to 2.0.24 or later.",
      );
      expect(unknown.view.result.current.steerBlockedReason).toBe(
        "OpenDucktor cannot read the OpenCode version. Steering needs OpenCode 2.0.24 or later.",
      );
      expect(missingDescriptor.view.result.current.steerBlockedReason).toBe(
        "The selected runtime is unavailable. Recheck runtime settings.",
      );
    } finally {
      supported.view.unmount();
      outdated.view.unmount();
      unknown.view.unmount();
      missingDescriptor.view.unmount();
    }
  });

  describe("sends", () => {
    test("refuses a send while the chat or the input cannot take it", async () => {
      const blocked = [
        renderChatSend({
          target: { canSend: false, resolve: existingSession },
        }),
        renderChatSend({ isWaitingInput: true }),
      ];
      try {
        for (const { view, sendAgentMessage } of blocked) {
          expect(await view.result.current.onSend(textDraft("Hello"), "default")).toBe(false);
          expect(sendAgentMessage).not.toHaveBeenCalled();
        }
      } finally {
        for (const { view } of blocked) view.unmount();
      }
    });

    test("lets an existing queueing session take a second send with its mode while the first waits", async () => {
      const firstSettles = createDeferred<void>();
      const { view, sendAgentMessage } = renderChatSend();
      sendAgentMessage.mockImplementationOnce(async () => {
        await firstSettles.promise;
        return null;
      });
      try {
        let first!: Promise<AgentChatSendResult>;
        act(() => {
          first = view.result.current.onSend(textDraft("First"), "default");
        });
        await act(async () => {
          expect(await view.result.current.onSend(textDraft("Second"), "steer")).toBe(true);
        });
        await act(async () => {
          firstSettles.resolve();
          expect(await first).toBe(true);
        });

        expect(sendAgentMessage.mock.calls.map(([, parts, options]) => [parts, options])).toEqual([
          [
            [{ kind: "text", text: "First" }],
            { mode: "default", assertCanSubmit: expect.any(Function) },
          ],
          [
            [{ kind: "text", text: "Second" }],
            { mode: "steer", assertCanSubmit: expect.any(Function) },
          ],
        ]);
      } finally {
        view.unmount();
      }
    });

    test("checks a steer against the model of the running turn", async () => {
      const textOnly = {
        ...PDF_MODEL,
        id: "openai/gpt-text",
        modelId: "gpt-text",
        attachmentSupport: NO_FILES,
      };
      const catalog = { ...MODEL_CATALOG, models: [PDF_MODEL, textOnly] };
      // The composer selects a text-only model while the running turn reads PDF files.
      const pdfTurn = renderChatSend(
        {
          isSessionWorking: true,
          modelCatalog: catalog,
          messages: [userMessageWithModel("gpt-5")],
          selectedModelDescriptor: textOnly,
        },
        { stageAttachment: stageBriefOnHost },
      );
      const textTurn = renderChatSend(
        {
          isSessionWorking: true,
          modelCatalog: catalog,
          messages: [userMessageWithModel("gpt-text")],
          selectedModelDescriptor: PDF_MODEL,
        },
        { stageAttachment: stageBriefOnHost },
      );
      try {
        await act(async () => {
          expect(await pdfTurn.view.result.current.onSend(attachmentDraft(), "default")).toBe(
            false,
          );
          expect(await pdfTurn.view.result.current.onSend(attachmentDraft(), "steer")).toBe(true);
          expect(await textTurn.view.result.current.onSend(attachmentDraft(), "steer")).toBe(false);
        });

        expect(pdfTurn.sendAgentMessage.mock.calls).toEqual([
          [
            SESSION,
            [
              { kind: "text", text: "please review" },
              {
                kind: "attachment",
                attachment: expect.objectContaining({ path: "/staged/brief.pdf" }),
              },
            ],
            { mode: "steer", assertCanSubmit: expect.any(Function) },
          ],
        ]);
        expect(textTurn.sendAgentMessage).not.toHaveBeenCalled();
      } finally {
        pdfTurn.view.unmount();
        textTurn.view.unmount();
      }
    });

    test("ends the send and reports a failure", async () => {
      const failure = new Error("send failed");
      const onFailure = mock((_cause: Error) => false);
      const { view, sendAgentMessage } = renderChatSend({
        target: { canSend: true, resolve: existingSession, onFailure },
      });
      sendAgentMessage.mockImplementationOnce(async () => {
        throw failure;
      });
      try {
        await act(async () => {
          expect(await view.result.current.onSend(textDraft("Hello"), "default")).toBe(false);
        });

        expect(onFailure.mock.calls).toEqual([[failure]]);
        expect(view.result.current.isSending).toBe(false);
      } finally {
        view.unmount();
      }
    });

    test("ends the send when attachment staging fails", async () => {
      const { view, sendAgentMessage } = renderChatSend(
        {},
        {
          stageAttachment: async () => {
            throw new Error("staging failed");
          },
        },
      );
      try {
        await act(async () => {
          await expect(view.result.current.onSend(attachmentDraft(), "default")).rejects.toThrow(
            "staging failed",
          );
        });

        expect(view.result.current.isSending).toBe(false);
        expect(sendAgentMessage).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    });
  });
});
