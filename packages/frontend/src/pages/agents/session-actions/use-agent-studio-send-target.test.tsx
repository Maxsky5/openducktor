import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { describe, expect, mock, test } from "bun:test";
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
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { createBrowserAttachmentStager } from "@/lib/local-attachment-files";
import { useAgentChatSendForTarget } from "@/test-utils/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import type { PropsWithChildren } from "react";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  SessionStartWorkflowError,
  type RunSessionStartWorkflow,
  type SessionStartWorkflowResult,
} from "@/features/session-start";
import {
  createDeferred,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
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

type StagedLocalAttachment = Awaited<ReturnType<HostClient["workspaceStageLocalAttachment"]>>;

const createTaskHarness = (args: HookArgs, client: Partial<HostClient> = {}) => {
  const host = createTestHostConnection({ client });
  const connection = createTestClientConnection({
    host,
    stageAttachment: createBrowserAttachmentStager(host.client),
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <AgentChatSendProviders>{children}</AgentChatSendProviders>
    </ClientConnectionProvider>
  );
  return createHookHarness(useTaskChatSend, args, { wrapper });
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

const createSelectedSessionIdentity = (externalSessionId: string | null) =>
  externalSessionId ? sessionIdentity(externalSessionId) : null;

const createBaseArgs = (): HookArgs => ({
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "spec",
  launchActionId: "spec_initial",
  selectionForNewSession: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
  selectedTask: createTaskCardFixture({ id: "task-1" }),
  canStartSession: true,
  runSessionStartWorkflow: async () => ({
    ...sessionIdentity("session-new"),
    postStartActionError: null,
  }),
  scheduleQueryUpdate: () => {},
  selectedSessionIdentity: createSelectedSessionIdentity("session-existing"),
  isCatalogLoading: false,

  assertCanPrepareSession: () => {},
  agentStudioReady: true,
  reusablePrompts: [],
  isStarting: false,
  sendAgentMessage: async () => null,
});

describe("useAgentStudioSendTarget", () => {
  test.each([null, "session-existing"])(
    "blocks task Send until the catalog read completes for %s",
    async (externalSessionId) => {
      const sendAgentMessage = mock(async () => null);
      const runSessionStartWorkflow = mock(createBaseArgs().runSessionStartWorkflow);
      const args = {
        ...createBaseArgs(),
        selectedSessionIdentity: createSelectedSessionIdentity(externalSessionId),
        isCatalogLoading: true,
        sendAgentMessage,
        runSessionStartWorkflow,
      };
      const harness = createTaskHarness(args);
      try {
        await harness.mount();
        await harness.run(async (state) => {
          expect(await state.onSend(createDraft("hello"), "default")).toBe(false);
        });
        expect(sendAgentMessage).not.toHaveBeenCalled();
        expect(runSessionStartWorkflow).not.toHaveBeenCalled();
        await harness.update({ ...args, isCatalogLoading: false });
        await harness.run(async (state) => {
          expect(await state.onSend(createDraft("hello"), "default")).toBe(true);
        });
        expect(sendAgentMessage).toHaveBeenCalledTimes(externalSessionId ? 1 : 0);
        expect(runSessionStartWorkflow).toHaveBeenCalledTimes(externalSessionId ? 0 : 1);
      } finally {
        await harness.unmount();
      }
    },
  );

  test("checks the send policy after attachment staging", async () => {
    const staged = createDeferred<StagedLocalAttachment>();
    const stage = mock(() => staged.promise);
    let blocked = false;
    const send = mock(async () => null);
    const harness = createTaskHarness(
      {
        ...createBaseArgs(),
        assertCanPrepareSession: () => {
          if (blocked) throw new Error("Answer the blocking question before sending.");
        },
        sendAgentMessage: send,
      },
      { workspaceStageLocalAttachment: stage },
    );
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
      expect(send).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("guard rejection does not start a session or send a message", async () => {
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      agentStudioReady: false,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("hello"), "default")).resolves.toBe(false);
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test.each(["model", "runtime", "start policy"] as const)(
    "blocks first Send when %s is unavailable",
    async (missing) => {
      const runSessionStartWorkflow = mock(createBaseArgs().runSessionStartWorkflow);
      const args: HookArgs = {
        ...createBaseArgs(),
        selectedSessionIdentity: null,
        runSessionStartWorkflow,
      };
      if (missing === "model") args.selectionForNewSession = null;
      if (missing === "runtime")
        args.selectionForNewSession = { providerId: "openai", modelId: "gpt-5" };
      if (missing === "start policy") args.canStartSession = false;
      const harness = createTaskHarness(args);
      try {
        await harness.mount();
        await harness.run(async (state) => {
          expect(await state.onSend(createDraft("hello"), "default")).toBe(false);
        });
        expect(runSessionStartWorkflow).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );

  test("blocks system compaction without a selected session", async () => {
    const sendAgentMessage = mock(async () => null);
    const runSessionStartWorkflow = mock(createBaseArgs().runSessionStartWorkflow);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      sendAgentMessage,
      runSessionStartWorkflow,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactionDraft(), "default")).rejects.toThrow(
        "/compact requires an existing selected session.",
      );
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(runSessionStartWorkflow).not.toHaveBeenCalled();
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
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      reusablePrompts: [compactReusablePrompt],
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createCompactReusablePromptDraft(), "default")).rejects.toThrow(
        "/compact is reserved for manual session compaction.",
      );
    });

    expect(sendAgentMessage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("blocks duplicate first Sends until selection changes and allows later preparation", async () => {
    const sendAgentMessage = mock(async () => null);
    const launched = createDeferred<SessionStartWorkflowResult>();
    const runSessionStartWorkflow = mock<RunSessionStartWorkflow>(() => launched.promise);
    const scheduleQueryUpdate = mock(() => {});
    const initialArgs: HookArgs = {
      ...createBaseArgs(),
      selectedSessionIdentity: createSelectedSessionIdentity(null),
      sendAgentMessage,
      runSessionStartWorkflow,
      scheduleQueryUpdate,
    };
    const harness = createTaskHarness(initialArgs);

    let firstSend!: Promise<AgentChatSendResult>;
    try {
      await harness.mount();
      await harness.run(async (state) => {
        firstSend = state.onSend(createDraft("start"), "default");
        expect(await state.onSend(createDraft("duplicate"), "default")).toBe(false);
      });
      await harness.waitFor(() => runSessionStartWorkflow.mock.calls.length === 1);
      expect(scheduleQueryUpdate).not.toHaveBeenCalled();
      expect(sendAgentMessage).not.toHaveBeenCalled();
      expect(runSessionStartWorkflow).toHaveBeenCalledWith({
        request: {
          taskId: "task-1",
          role: "spec",
          launchActionId: "spec_initial",
          postStartAction: "send_message",
          parts: [{ kind: "text", text: "start" }],
          assertBeforeLaunch: expect.any(Function),
        },
        decision: { startMode: "fresh", selectedModel: initialArgs.selectionForNewSession },
        task: initialArgs.selectedTask,
        isCurrent: expect.any(Function),
      });
      await harness.run(async () => {
        launched.resolve({ ...sessionIdentity("session-new"), postStartActionError: null });
        expect(await firstSend).toBe(true);
      });
      expect(scheduleQueryUpdate).toHaveBeenCalledWith({
        task: "task-1",
        session: "session-new",
        agent: "spec",
      });
      expect(sendAgentMessage).not.toHaveBeenCalled();
      await harness.run(async (state) => {
        expect(await state.onSend(createDraft("before selection"), "default")).toBe(false);
      });
      expect(runSessionStartWorkflow).toHaveBeenCalledTimes(1);
      await harness.update({
        ...initialArgs,
        selectedSessionIdentity: sessionIdentity("session-new"),
      });
      await harness.update(initialArgs);
      runSessionStartWorkflow.mockResolvedValue({
        ...sessionIdentity("session-newer"),
        postStartActionError: null,
      });
      await harness.run(async (state) => {
        expect(await state.onSend(createDraft("new preparation"), "default")).toBe(true);
      });
      expect(runSessionStartWorkflow).toHaveBeenCalledTimes(2);
      expect(sendAgentMessage).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps an admitted launch after a context switch without selecting its session", async () => {
    const launched = createDeferred<SessionStartWorkflowResult>();
    const runSessionStartWorkflow = mock<RunSessionStartWorkflow>(() => launched.promise);
    const scheduleQueryUpdate = mock(() => {});
    const args: HookArgs = {
      ...createBaseArgs(),
      selectedSessionIdentity: null,
      runSessionStartWorkflow,
      scheduleQueryUpdate,
    };
    const harness = createTaskHarness(args);
    let pending!: Promise<AgentChatSendResult>;
    try {
      await harness.mount();
      await harness.run((state) => {
        pending = state.onSend(createDraft("start"), "default");
      });
      await harness.waitFor(() => runSessionStartWorkflow.mock.calls.length === 1);
      const input = runSessionStartWorkflow.mock.calls[0]?.[0];
      expect(input?.isCurrent?.()).toBe(true);
      expect(() => input?.request.assertBeforeLaunch?.()).not.toThrow();
      await harness.update({ ...args, taskId: "task-2" });
      expect(input?.isCurrent?.()).toBe(false);
      expect(() => input?.request.assertBeforeLaunch?.()).toThrow(
        "The original chat is no longer selected.",
      );
      await harness.run(async () => {
        launched.resolve({ ...sessionIdentity("session-new"), postStartActionError: null });
        expect(await pending).toBe(true);
      });
      expect(scheduleQueryUpdate).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test.each(["accepted", "unknown"] as const)(
    "consumes the first draft after a launch error with %s delivery",
    async (delivery) => {
      const sendAgentMessage = mock(async () => null);
      const workflow: SessionStartWorkflowResult = {
        ...sessionIdentity("session-new"),
        postStartActionError: new Error("Inspect the session before sending again."),
      };
      if (delivery === "accepted")
        workflow.postStartMessageReceipt = {
          outcome: "accepted",
          recipient: sessionIdentity("session-new"),
          postAcceptanceFailure: workflow.postStartActionError?.message ?? null,
          acceptedMessage: {
            type: "user_message",
            externalSessionId: "session-new",
            messageId: "message-1",
            message: "start",
            parts: [{ kind: "text", text: "start" }],
            timestamp: "2026-10-25T12:00:00.000Z",
            state: "read",
          },
        };
      const runSessionStartWorkflow = mock<RunSessionStartWorkflow>(async () => workflow);
      const harness = createTaskHarness({
        ...createBaseArgs(),
        selectedSessionIdentity: null,
        runSessionStartWorkflow,
        sendAgentMessage,
      });
      try {
        await harness.mount();
        await harness.run(async (state) => {
          expect(await state.onSend(createDraft("start"), "default")).toBe(true);
        });
        expect(sendAgentMessage).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );

  test.each(["outcome_unknown", "connection_expired"] as const)(
    "retries a rejected first launch only when its admission is known: %s",
    async (code) => {
      const error = new SessionStartWorkflowError(
        new RemoteConnectionError({
          code,
          message: "The remote launch did not return.",
          nextAction: "Read current host state before sending again.",
        }),
        true,
      );
      const runSessionStartWorkflow = mock<RunSessionStartWorkflow>(async () => {
        throw error;
      });
      const args: HookArgs = {
        ...createBaseArgs(),
        selectedSessionIdentity: null,
        runSessionStartWorkflow,
      };
      const harness = createTaskHarness(args);
      try {
        await harness.mount();
        await harness.run(async (state) => {
          await expect(state.onSend(createDraft("start"), "default")).rejects.toBe(error);
        });
        await harness.update({ ...args, agentStudioReady: false });
        await harness.update(args);
        await harness.update({ ...args, taskId: "task-2" });
        await harness.update(args);
        await harness.run(async (state) => {
          const retry = state.onSend(createDraft("start"), "default");
          if (code === "outcome_unknown") await expect(retry).resolves.toBe(false);
          else await expect(retry).rejects.toBe(error);
        });
        expect(runSessionStartWorkflow).toHaveBeenCalledTimes(code === "outcome_unknown" ? 1 : 2);
      } finally {
        await harness.unmount();
      }
    },
  );

  test("blocks sends while the selected session model is not sendable", async () => {
    const sendAgentMessage = mock(async () => null);
    const harness = createTaskHarness({
      ...createBaseArgs(),
      assertCanPrepareSession: () => {
        throw new Error("No valid model is available");
      },
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("hello"), "default")).rejects.toThrow("No valid model");
    });

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

    const harness = createTaskHarness({
      ...createBaseArgs(),
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
      sendAgentMessage,
    });
    await harness.waitFor((state) => !state.isSending);

    await harness.run(async (state) => {
      await expect(state.onSend(createDraft("second"), "default")).resolves.toBe(true);
    });

    // The first context shows its unresolved send again after a switch back.
    await harness.update({ ...createBaseArgs(), sendAgentMessage });
    expect(harness.getLatest().isSending).toBe(true);

    await harness.run(async () => {
      firstSendDeferred.resolve();
      await expect(firstSend).resolves.toBe(true);
    });
    await harness.waitFor((state) => !state.isSending);

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
      const staged = createDeferred<StagedLocalAttachment>();
      const stage = mock(() => staged.promise);
      const sendAgentMessage = mock(async () => null);
      const runSessionStartWorkflow = mock(createBaseArgs().runSessionStartWorkflow);
      const args: HookArgs = {
        ...createBaseArgs(),
        selectedSessionIdentity: null,
        runSessionStartWorkflow,
        sendAgentMessage,
      };
      const harness = createTaskHarness(args, { workspaceStageLocalAttachment: stage });
      let submitted!: Promise<AgentChatSendResult>;
      try {
        await harness.mount();
        await harness.run((state) => {
          submitted = state.onSend(createAttachmentDraft(), "default");
        });
        await harness.waitFor(() => stage.mock.calls.length === 1);
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
        expect(sendAgentMessage).not.toHaveBeenCalled();
        expect(runSessionStartWorkflow).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );
});
