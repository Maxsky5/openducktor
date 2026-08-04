import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type ReusablePrompt,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { hostClient } from "@/lib/host-client";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { createDeferred, enableReactActEnvironment } from "../agent-studio-test-utils";
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

const createCompactionDraft = (): AgentChatComposerDraft => ({
  segments: [createSlashCommandSegment(MANUAL_SESSION_COMPACTION_SLASH_COMMAND)],
  attachments: [],
});

const compactReusablePrompt: ReusablePrompt = {
  id: "prompt-compact",
  name: "COMPACT",
  description: "Custom compact",
  content: "Start a new session by summarizing context",
};

const createCompactReusablePromptDraft = (): AgentChatComposerDraft => ({
  segments: [createSlashCommandSegment(toReusablePromptSlashCommand(compactReusablePrompt))],
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

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const sessionWorkflowResult = (externalSessionId: string) => ({
  ...sessionIdentity(externalSessionId),
  postStartActionError: null,
});

const createSelectedSessionIdentity = (externalSessionId: string | null) =>
  externalSessionId ? sessionIdentity(externalSessionId) : null;

const createSessionState = (
  overrides: Partial<HookArgs["sessionState"]> = {},
): HookArgs["sessionState"] => ({
  isWaitingInput: false,
  canQueueBusyFollowups: false,
  busySendBlockedReason: null,
  ...overrides,
});

const createBaseArgs = (): HookArgs => ({
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "spec",
  selectedSessionIdentity: createSelectedSessionIdentity("session-existing"),
  selectedSessionModel: null,
  sessionState: createSessionState(),
  isSessionModelCatalogLoading: false,
  isSelectedSessionModelSendable: true,
  agentStudioReady: true,
  canStartNewSession: true,
  reusablePrompts: [],
  isStarting: false,
  selectedModelDescriptor,
  supportsAttachments: true,
  sendAgentMessage: async () => {},
  startSession: async () => sessionWorkflowResult("session-new"),
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
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
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

  test("rejects stale system compaction before starting a new session", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactionDraft())).rejects.toThrow(
        "/compact requires an existing selected session",
      );
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("sends system compaction to an existing Claude session", async () => {
    const sendAgentMessage = mock(async () => {});
    const claudeSession = {
      externalSessionId: "claude-session",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktrees/claude-session",
    };
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      selectedSessionIdentity: claudeSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactionDraft())).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(claudeSession, [
      {
        kind: "slash_command",
        command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      },
    ]);
    await harness.unmount();
  });

  test("does not start a repository session from a stale custom compact prompt", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      reusablePrompts: [compactReusablePrompt],
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactReusablePromptDraft())).resolves.toBe(false);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("uses parent start policy only when a new session would be started", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => {});
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      canStartNewSession: false,
      startSession,
      sendAgentMessage,
    };
    const harness = createHookHarness(useAgentStudioSendAction, initialArgs);

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("start"))).resolves.toBe(false);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.update({
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity("session-existing"),
      canStartNewSession: false,
      startSession,
      sendAgentMessage,
    });
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("follow up"))).resolves.toBe(true);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-existing"), [
      { kind: "text", text: "follow up" },
    ]);

    await harness.unmount();
  });

  test("blocks sends while the selected session model is not sendable", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      isSelectedSessionModelSendable: false,
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
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
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
      selectedSessionIdentity: createSelectedSessionIdentity("session-new"),
      startSession,
      sendAgentMessage,
    });
    await harness.waitFor((state) => state.isSending);

    await harness.run(async () => {
      sendDeferred.resolve();
      await sendPromise;
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).toHaveBeenCalledWith({ holdForPostStartMessage: true });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-new"), [
      { kind: "text", text: "hello" },
    ]);

    await harness.unmount();
  });

  test("tracks a new-session send before session start resolves", async () => {
    const startDeferred = createDeferred<ReturnType<typeof sessionWorkflowResult>>();
    const startSession = mock(() => startDeferred.promise);
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
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
      startDeferred.resolve(sessionWorkflowResult("session-new"));
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).toHaveBeenCalledWith({ holdForPostStartMessage: true });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-new"), [
      { kind: "text", text: "first" },
    ]);

    await harness.unmount();
  });

  test("blocks concurrent sends in the same context before a render updates state", async () => {
    const sendDeferred = createDeferred<void>();
    const sendAgentMessage = mock(() => sendDeferred.promise);
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const harness = createHookHarness(useAgentStudioSendAction, {
      ...createBaseArgs(),
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    let firstSend: Promise<boolean> | undefined;
    let secondSend: Promise<boolean> | undefined;
    await harness.run((state) => {
      firstSend = state.onSend(createDraft("first"));
      secondSend = state.onSend(createDraft("second"));
    });

    await expect(secondSend).resolves.toBe(false);
    await harness.waitFor((state) => state.isSending);

    await harness.run(async () => {
      sendDeferred.resolve();
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-existing"), [
      { kind: "text", text: "first" },
    ]);

    await harness.unmount();
  });

  test("allows sending in a different active context while another context is unresolved", async () => {
    const firstSendDeferred = createDeferred<void>();
    const sendAgentMessage = mock((session: AgentSessionIdentity) => {
      if (session.externalSessionId === "session-existing") {
        return firstSendDeferred.promise;
      }
      return Promise.resolve();
    });
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
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
      selectedSessionIdentity: createSelectedSessionIdentity("session-other"),
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
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-existing"), [
      { kind: "text", text: "first" },
    ]);
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-other"), [
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
