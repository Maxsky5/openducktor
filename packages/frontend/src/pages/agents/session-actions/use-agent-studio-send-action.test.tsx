import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { hostClient } from "@/lib/host-client";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createDeferred,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { useAgentStudioSendAction } from "./use-agent-studio-send-action";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSendAction>[0];

const selectedModelDescriptor: AgentModelCatalog["models"][number] = {
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
};

const createDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

const createAttachmentDraft = (): AgentChatComposerDraft => {
  const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
  return {
    segments: [createTextSegment("please review")],
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

const createBaseArgs = (): HookArgs => ({
  activeWorkspace: {
    repoPath: "/repo",
    workspaceId: "workspace-1",
    workspaceName: "Active Workspace",
  },
  taskId: "task-1",
  role: "spec",
  activeExternalSessionId: "session-existing",
  activeSessionIsLoadingModelCatalog: false,
  activeSessionSelectedModel: null,
  agentStudioReady: true,
  canQueueBusyFollowups: false,
  reusablePrompts: [],
  isStarting: false,
  isWaitingInput: false,
  busySendBlockedReason: null,
  selectedTask: createTaskCardFixture(),
  selectedModelDescriptor,
  sendAgentMessage: async () => {},
  startSession: async () => "session-new",
});

describe("useAgentStudioSendAction", () => {
  const originalWorkspaceStageLocalAttachment = hostClient.workspaceStageLocalAttachment;

  beforeEach(() => {
    hostClient.workspaceStageLocalAttachment = originalWorkspaceStageLocalAttachment;
  });

  afterEach(() => {
    hostClient.workspaceStageLocalAttachment = originalWorkspaceStageLocalAttachment;
  });

  test("guard rejection does not start a session or send a message", async () => {
    const startSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      activeExternalSessionId: null,
      agentStudioReady: false,
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("hello"))).resolves.toBe(false);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("tracks a new-session send across draft and target session contexts", async () => {
    const sendDeferred = createDeferred<void>();
    const startSession = mock(async () => "session-new");
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      activeExternalSessionId: null,
      startSession,
      sendAgentMessage,
    };
    const harness = createHookHarness(useAgentStudioSendAction, initialArgs);

    await harness.mount();
    let sendPromise: Promise<boolean> | undefined;
    await harness.run((state) => {
      sendPromise = state.onSend(createDraft("hello"));
    });

    await harness.waitFor((state) => state.isSending);
    await harness.update({
      ...createBaseArgs(),
      activeExternalSessionId: "session-new",
      startSession,
      sendAgentMessage,
    });
    await harness.waitFor((state) => state.isSending);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", [{ kind: "text", text: "hello" }]);

    await harness.unmount();
  });

  test("tracks a new-session send before session start resolves", async () => {
    const startDeferred = createDeferred<string>();
    const startSession = mock(() => startDeferred.promise);
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      activeExternalSessionId: null,
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    let firstSend: Promise<boolean> | undefined;
    await harness.run((state) => {
      firstSend = state.onSend(createDraft("first"));
    });

    await harness.waitFor((state) => state.isSending);

    await harness.run(async () => {
      startDeferred.resolve("session-new");
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith("session-new", [{ kind: "text", text: "first" }]);

    await harness.unmount();
  });

  test("allows sending in a different active context while another context is unresolved", async () => {
    const firstSendDeferred = createDeferred<void>();
    const sendAgentMessage = mock((sessionId: string) => {
      if (sessionId === "session-existing") {
        return firstSendDeferred.promise;
      }
      return Promise.resolve();
    });
    const startSession = mock(async () => "session-new");
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    let firstSend: Promise<boolean> | undefined;
    await harness.run((state) => {
      firstSend = state.onSend(createDraft("first"));
    });
    await harness.waitFor((state) => state.isSending);

    await harness.update({
      ...createBaseArgs(),
      activeExternalSessionId: "session-other",
      startSession,
      sendAgentMessage,
    });
    await harness.waitFor((state) => !state.isSending);

    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("second"))).resolves.toBe(true);
    });

    await harness.update({
      ...createBaseArgs(),
      startSession,
      sendAgentMessage,
    });
    await harness.waitFor((state) => state.isSending);
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("third"))).resolves.toBe(false);
    });

    await harness.run(async () => {
      firstSendDeferred.resolve();
      await expect(firstSend).resolves.toBe(true);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenCalledWith("session-existing", [
      { kind: "text", text: "first" },
    ]);
    expect(sendAgentMessage).toHaveBeenCalledWith("session-other", [
      { kind: "text", text: "second" },
    ]);

    await harness.unmount();
  });

  test("attachment staging failures clear in-flight send state", async () => {
    const sendAgentMessage = mock(async () => {});
    hostClient.workspaceStageLocalAttachment = async () => {
      throw new Error("staging failed");
    };
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createAttachmentDraft())).rejects.toThrow("staging failed");
    });

    expect(harness.getLatest().isSending).toBe(false);
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
