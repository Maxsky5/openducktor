import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { type PropsWithChildren } from "react";
import { startSessionWorkflow } from "@/features/session-start/session-start-workflow";
import { replaceAgentSession } from "@/state/agent-session-collection";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import {
  AgentSessionReadModelStateContext,
  HostRuntimeStatusContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "@/state/operations/agent-orchestrator/handlers/session-actions.test-helpers";
import {
  createOpenCodeAgentEngineTestAdapter,
  createTestOpencodeSdkAdapter,
} from "@/state/operations/agent-orchestrator/handlers/opencode-agent-engine.test-support";
import { acceptedUserMessage } from "@/state/operations/agent-orchestrator/handlers/session-actions-send.test-support";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createHostRuntimeStatusContextValue } from "@/test-utils/shared-test-fixtures";
import { useAgentMessageSendPolicy } from "./use-agent-message-send-policy";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";

test.each(["fresh", "fork"] as const)(
  "only the launch owner can send first after coalesced %s starts",
  async (startMode) => {
    const launched = Promise.withResolvers<void>();
    const releaseLaunch = Promise.withResolvers<void>();
    const joined = Promise.withResolvers<void>();
    const preparing = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<void>();
    let launches = 0;
    let requests = 0;
    let preparations = 0;
    const sent: string[] = [];
    const adapter = createOpenCodeAgentEngineTestAdapter(createTestOpencodeSdkAdapter());
    const launch = async () => {
      launches += 1;
      launched.resolve();
      await releaseLaunch.promise;
      return {
        runtimeKind: "opencode" as const,
        externalSessionId: "started",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-10-08T00:00:00Z",
        status: "idle" as const,
      };
    };
    adapter.forkSession = launch;
    adapter.loadSessionHistory = async () => [];
    adapter.sendUserMessage = async (input) => {
      sent.push(input.parts[0]?.kind === "text" ? input.parts[0].text : "");
      return acceptedUserMessage(input);
    };
    const source = buildSession({ status: "idle", historyLoadState: "loaded" });
    const sessionsRef = createSessionsRef([source]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      startWorkflowSession: launch,
      loadRepoPromptOverrides: async () => {
        if (launches === 0) return {};
        if (++preparations === 1) {
          preparing.resolve();
          await prepared.promise;
        }
        return {};
      },
    });
    const harness = await mountPolicy();
    const queryClient = new QueryClient();
    const run = (message: string) =>
      startSessionWorkflow({
        queryClient,
        workspaceId: "workspace-1",
        task: null,
        selection: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
        intent: {
          taskId: "task-1",
          role: "build",
          launchActionId: "build_rebase_conflict_resolution",
          startMode,
          sourceSession: source,
          targetWorkingDirectory: source.workingDirectory,
          postStartAction: "send_message",
          message,
          assertCanSubmit: harness.getLatest(),
        },
        startAgentSession: (input) => {
          const result = actions.startAgentSession(input);
          if (++requests === 2) joined.resolve();
          return result;
        },
        sendAgentMessage: actions.sendAgentMessage,
      });
    const first = run("First prompt");
    await launched.promise;
    const second = run("Second prompt");
    try {
      await joined.promise;
      releaseLaunch.resolve();
      await preparing.promise;
      const result = await second;
      expect(result.postStartActionError).toBeInstanceOf(Error);
      expect(result.postStartActionError?.message).toContain("finish starting");
      expect(launches).toBe(1);
      expect(sent).toEqual([]);
      expect(getSession(sessionsRef, "started").status).toBe("starting");
    } finally {
      releaseLaunch.resolve();
      prepared.resolve();
      await Promise.all([first, second]);
      queryClient.clear();
      await harness.unmount();
    }
    expect(sent).toEqual(["First prompt"]);
  },
);

test.each([
  ["fresh", false],
  ["fresh", true],
  ["fork", false],
  ["fork", true],
] as const)(
  "%s first-message retry keeps its start, newer episode=%s",
  async (startMode, newer) => {
    const preparing = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<void>();
    let current = true;
    let submissions = 0;
    const adapter = createTestOpencodeSdkAdapter();
    adapter.sendUserMessage = async (input) => {
      submissions += 1;
      return acceptedUserMessage(input);
    };
    const sessionsRef = createSessionsRef([
      buildSession({ status: "starting", historyLoadState: "loaded", executionEpisodeId: "first" }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      loadRepoPromptOverrides: async () => {
        preparing.resolve();
        await prepared.promise;
        return {};
      },
    });
    const harness = await mountPolicy();
    const queryClient = new QueryClient();
    const starting = startSessionWorkflow({
      queryClient,
      workspaceId: "workspace-1",
      task: null,
      selection: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
      intent: {
        taskId: "task-1",
        role: "build",
        launchActionId: "build_rebase_conflict_resolution",
        startMode,
        sourceSession: getSession(sessionsRef),
        postStartAction: "send_message",
        message: "Resolve conflict",
        assertCanSubmit: (session, ownsStart) => {
          harness.getLatest()(session, ownsStart);
          if (!current) throw new Error("Selection changed");
        },
      },
      startAgentSession: async (input) => {
        const session = getSession(sessionsRef);
        if (input.startMode !== "reuse") input.claimStart?.(session);
        return session;
      },
      sendAgentMessage: actions.sendAgentMessage,
    });
    try {
      await preparing.promise;
      expect(getSession(sessionsRef).status).toBe("starting");
      current = false;
      prepared.resolve();
      const result = await starting;
      expect(result.postStartActionError?.message).toBe("Selection changed");
      expect(submissions).toBe(0);
      expect(getSession(sessionsRef).status).toBe("idle");
      current = true;
      if (newer) {
        sessionsRef.current = replaceAgentSession(sessionsRef.current, {
          ...getSession(sessionsRef),
          status: "starting",
          executionEpisodeId: "newer",
        });
        await expect(result.retryPostStartMessage!()).rejects.toThrow("finish starting");
        expect(submissions).toBe(0);
        expect(getSession(sessionsRef).status).toBe("starting");
      } else {
        await result.retryPostStartMessage!();
        await result.retryPostStartMessage!();
        expect(submissions).toBe(1);
        expect(getSession(sessionsRef).status).toBe("running");
      }
    } finally {
      prepared.resolve();
      await starting;
      queryClient.clear();
      await harness.unmount();
    }
  },
);

test("conflict reuse cannot pass a first prompt that is still in preparation", async () => {
  const prepared = Promise.withResolvers<void>();
  const preparing = Promise.withResolvers<void>();
  const sent: string[] = [];
  let preparations = 0;
  const adapter = createTestOpencodeSdkAdapter();
  adapter.sendUserMessage = async (input) => {
    sent.push(input.parts[0]?.kind === "text" ? input.parts[0].text : "");
    return acceptedUserMessage(input);
  };
  const sessionsRef = createSessionsRef([
    buildSession({ status: "starting", historyLoadState: "loaded", executionEpisodeId: "first" }),
  ]);
  const actions = createSessionActions({
    adapter,
    sessionsRef,
    loadRepoPromptOverrides: async () => {
      if (++preparations === 1) {
        preparing.resolve();
        await prepared.promise;
      }
      return {};
    },
  });
  const harness = await mountPolicy();
  const queryClient = new QueryClient();
  const first = actions.sendAgentMessage(getSession(sessionsRef), [
    { kind: "text", text: "First prompt" },
  ]);
  try {
    await preparing.promise;
    const result = await startSessionWorkflow({
      queryClient,
      workspaceId: "workspace-1",
      task: null,
      selection: null,
      intent: {
        taskId: "task-1",
        role: "build",
        launchActionId: "build_rebase_conflict_resolution",
        startMode: "reuse",
        sourceSession: getSession(sessionsRef),
        postStartAction: "send_message",
        message: "Resolve conflict",
        assertCanSubmit: harness.getLatest(),
      },
      startAgentSession: actions.startAgentSession,
      sendAgentMessage: actions.sendAgentMessage,
    });
    expect(result.postStartActionError).toBeInstanceOf(Error);
    expect(result.postStartActionError?.message).toContain("finish starting");
    expect(sent).toEqual([]);
    expect(getSession(sessionsRef).status).toBe("starting");
  } finally {
    prepared.resolve();
    await first;
    queryClient.clear();
    await harness.unmount();
  }
  expect(sent).toEqual(["First prompt"]);
});

test.each([
  ["title sync", { message: "Could not sync this Workspace Session title to Codex." }, true],
  ["saved target", { source: "workspace-target", message: "Runtime directory mismatch" }, false],
] satisfies Array<[string, AgentSessionTransientFault, boolean]>)(
  "%s fault follows the session's write access",
  async (_name, fault, canSend) => {
    let submissions = 0;
    const adapter = createTestOpencodeSdkAdapter();
    adapter.sendUserMessage = async (input) => {
      submissions += 1;
      return acceptedUserMessage(input);
    };
    const session = buildSession({ status: "idle", historyLoadState: "loaded" });
    const actions = createSessionActions({ adapter, sessionsRef: createSessionsRef([session]) });
    const harness = await mountPolicy(fault);
    try {
      const send = () =>
        actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }], {
          assertCanSubmit: harness.getLatest(),
        });
      if (canSend) {
        const receipt = await send();
        expect(receipt?.acceptedMessage).toBeDefined();
        expect(submissions).toBe(1);
      } else {
        await expect(send()).rejects.toThrow(fault.message);
        expect(submissions).toBe(0);
      }
    } finally {
      await harness.unmount();
    }
  },
);

async function mountPolicy(fault: AgentSessionTransientFault | null = null) {
  const runtimes = createRuntimeDefinitionsContextValue();
  const status = createHostRuntimeStatusContextValue();
  const wrapper = ({ children }: PropsWithChildren) => (
    <RuntimeDefinitionsContext value={runtimes}>
      <HostRuntimeStatusContext value={status}>
        <AgentSessionReadModelStateContext
          value={{
            sessionReadModelLoadState: { kind: "ready", workspaceRepoPath: "/tmp/repo" },
            workspaceSessionRecordsError: null,
            reloadSessionReadModel: () => {},
            getSessionFault: () => fault,
          }}
        >
          {children}
        </AgentSessionReadModelStateContext>
      </HostRuntimeStatusContext>
    </RuntimeDefinitionsContext>
  );
  const harness = createHookHarness(() => useAgentMessageSendPolicy(), undefined, { wrapper });
  await harness.mount();
  return harness;
}
