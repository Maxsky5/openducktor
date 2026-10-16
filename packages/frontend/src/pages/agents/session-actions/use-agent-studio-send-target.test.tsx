import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
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
import { useAgentChatSendForTarget } from "@/test-utils/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { createDeferred, enableReactActEnvironment } from "../agent-studio-test-utils";
import { useAgentStudioSendTarget } from "./use-agent-studio-send-target";

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

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSendTarget>[0] & {
  reusablePrompts: ReusablePrompt[];
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
};

/** An Agent Studio chat: its send target with the shared send rules. */
const useTaskChatSend = ({ reusablePrompts, sendAgentMessage, ...targetArgs }: HookArgs) =>
  useAgentChatSendForTarget(useAgentStudioSendTarget(targetArgs), {
    identity: targetArgs.selectedSessionIdentity,
    selectedModelDescriptor,
    draftRules: { reusablePrompts, supportsAttachments: true },
    sendAgentMessage,
  });

const createTaskHarness = (args: HookArgs) =>
  createHookHarness(useTaskChatSend, args, { wrapper: AgentChatSendProviders });

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

const createBaseArgs = (): HookArgs => ({
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "spec",
  selectedSessionIdentity: createSelectedSessionIdentity("session-existing"),
  isSessionModelCatalogLoading: false,

  assertCanPrepareSession: () => {},
  agentStudioReady: true,
  canStartNewSession: true,
  reusablePrompts: [],
  isStarting: false,
  sendAgentMessage: async () => null,
  startSession: async () => sessionWorkflowResult("session-new"),
});

describe("useAgentStudioSendTarget", () => {
  const originalWorkspaceStageLocalAttachment = hostClient.workspaceStageLocalAttachment;

  beforeEach(() => {
    hostClient.workspaceStageLocalAttachment = originalWorkspaceStageLocalAttachment;
  });

  afterEach(() => {
    hostClient.workspaceStageLocalAttachment = originalWorkspaceStageLocalAttachment;
  });

  test("blocks task Send until the required catalog read completes", async () => {
    const sendAgentMessage = mock(async () => null);
    const prepare = mock(async () => () => {});
    const args = {
      ...createBaseArgs(),
      isSessionModelCatalogLoading: true,
      sendAgentMessage,
    };
    const harness = createTaskHarness(args);
    try {
      await harness.mount();
      await harness.run(async (state) => {
        expect(await state.onSend(createDraft("hello"), "default")).toBe(false);
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(sendAgentMessage).not.toHaveBeenCalled();
      await harness.update({ ...args, isSessionModelCatalogLoading: false });
      await harness.run(async (state) => {
        expect(await state.onSend(createDraft("hello"), "default")).toBe(true);
      });
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("checks the current send policy after attachment staging and before model preparation", async () => {
    const staged =
      createDeferred<Awaited<ReturnType<typeof hostClient.workspaceStageLocalAttachment>>>();
    const stage = mock(() => staged.promise);
    hostClient.workspaceStageLocalAttachment = stage;
    let blocked = false;
    const prepare = mock(async () => () => {});
    const send = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      assertCanPrepareSession: () => {
        if (blocked) throw new Error("Answer the blocking question before sending.");
      },
      sendAgentMessage: send,
    });
    let pending!: Promise<unknown>;
    try {
      await harness.mount();
      await harness.run((state) => {
        pending = state.onSend(createAttachmentDraft(), "default").catch((cause) => cause);
      });
      await harness.waitFor(() => stage.mock.calls.length === 1);
      blocked = true;
      await harness.run(async () => {
        staged.resolve({ path: "/tmp/brief.pdf" });
        await pending;
      });
      expect(await pending).toEqual(
        expect.objectContaining({ message: "Answer the blocking question before sending." }),
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("guard rejection does not start a session or send a message", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      agentStudioReady: false,
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("hello"), "default")).resolves.toBe(false);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("rejects stale system compaction before starting a new session", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactionDraft(), "default")).rejects.toThrow(
        "/compact requires an existing selected session",
      );
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("sends system compaction to an existing Claude session", async () => {
    const sendAgentMessage = mock(async () => null);
    const claudeSession = {
      externalSessionId: "claude-session",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktrees/claude-session",
    };
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: claudeSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactionDraft(), "default")).resolves.toBe(true);
    });

    expect(sendAgentMessage).toHaveBeenCalledWith(
      claudeSession,
      [
        {
          kind: "slash_command",
          command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        },
      ],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );
    await harness.unmount();
  });

  test("reports a reserved custom compact prompt without starting a repository session", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      reusablePrompts: [compactReusablePrompt],
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactReusablePromptDraft(), "default")).rejects.toThrow(
        "/compact is reserved for manual session compaction.",
      );
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("uses parent start policy only when a new session would be started", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => null);
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      canStartNewSession: false,
      startSession,
      sendAgentMessage,
    };
    const harness = createTaskHarness(initialArgs);

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("start"), "default")).resolves.toBe(false);
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
      await expect(state.onSend(createDraft("follow up"), "default")).resolves.toBe(true);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith(
      sessionIdentity("session-existing"),
      [{ kind: "text", text: "follow up" }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );

    await harness.unmount();
  });

  test("blocks sends while the selected session model is not sendable", async () => {
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      assertCanPrepareSession: () => {
        throw new Error("No valid model is available");
      },
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("hello"), "default")).rejects.toThrow("No valid model");
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("tracks a new-session send before session start resolves", async () => {
    const startDeferred = createDeferred<ReturnType<typeof sessionWorkflowResult>>();
    const startSession = mock(() => startDeferred.promise);
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    let firstSend: Promise<AgentChatSendResult> | undefined;
    await harness.run((state) => {
      firstSend = state.onSend(createDraft("first"), "default");
    });

    await harness.waitFor((state) => state.isSending);

    await harness.run(async () => {
      startDeferred.resolve(sessionWorkflowResult("session-new"));
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).toHaveBeenCalledWith([{ kind: "text", text: "first" }]);
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("allows sending in a different active context while another context is unresolved", async () => {
    const firstSendDeferred = createDeferred<void>();
    const sendAgentMessage = mock((session: AgentSessionIdentity) => {
      if (session.externalSessionId === "session-existing") {
        return firstSendDeferred.promise.then(() => null);
      }
      return Promise.resolve(null);
    });
    const startSession = mock(async () => sessionWorkflowResult("session-new"));
    const harness = createTaskHarness({
      ...createBaseArgs(),
      startSession,
      sendAgentMessage,
    });

    await harness.mount();
    let firstSend: Promise<AgentChatSendResult> | undefined;
    await harness.run((state) => {
      firstSend = state.onSend(createDraft("first"), "default");
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
      await expect(state.onSend(createDraft("second"), "default")).resolves.toBe(true);
    });

    // The first context shows its unresolved send again after a switch back.
    await harness.update({ ...createBaseArgs(), startSession, sendAgentMessage });
    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      firstSendDeferred.resolve();
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

    expect(startSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      sessionIdentity("session-existing"),
      [{ kind: "text", text: "first" }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );
    expect(sendAgentMessage).toHaveBeenCalledWith(
      sessionIdentity("session-other"),
      [{ kind: "text", text: "second" }],
      expect.objectContaining({ mode: "default", assertCanSubmit: expect.any(Function) }),
    );

    await harness.unmount();
  });

  test.each(["workspace", "task", "role"] as const)(
    "cancels staged submission after a %s switch",
    async (context) => {
      const staged =
        createDeferred<Awaited<ReturnType<typeof hostClient.workspaceStageLocalAttachment>>>();
      const stage = mock(() => staged.promise);
      hostClient.workspaceStageLocalAttachment = stage;
      const startSession = mock(async () => sessionWorkflowResult("never"));
      const sendAgentMessage = mock(async () => null);
      const args: HookArgs = {
        ...createBaseArgs(),
        selectedSessionIdentity: null,
        startSession,
        sendAgentMessage,
      };
      const harness = createTaskHarness(args);
      let submitted!: Promise<AgentChatSendResult>;
      try {
        await harness.mount();
        await harness.run((state) => {
          submitted = state.onSend(createAttachmentDraft(), "default");
        });
        await harness.waitFor(() => stage.mock.calls.length === 1);
        await harness.run(async (state) => {
          expect(await state.onSend(createAttachmentDraft(), "default")).toBe(false);
        });
        const nextArgs: HookArgs = { ...args };
        if (context === "workspace") nextArgs.workspaceId = "workspace-2";
        if (context === "task") nextArgs.taskId = "task-2";
        if (context === "role") nextArgs.role = "planner";
        await harness.update(nextArgs);
        expect(harness.getLatest().isSending).toBe(false);
        await harness.run(async () => {
          staged.resolve({ path: "/tmp/brief.pdf" });
          expect(await submitted).toBe(false);
        });
        expect(stage).toHaveBeenCalledTimes(1);
        expect(startSession).not.toHaveBeenCalled();
        expect(sendAgentMessage).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );
});
