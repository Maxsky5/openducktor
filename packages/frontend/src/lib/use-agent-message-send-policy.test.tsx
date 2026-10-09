import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { type PropsWithChildren } from "react";
import { startSessionWorkflow } from "@/features/session-start/session-start-workflow";
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
import { createTestOpencodeSdkAdapter } from "@/state/operations/agent-orchestrator/handlers/opencode-agent-engine.test-support";
import { acceptedUserMessage } from "@/state/operations/agent-orchestrator/handlers/session-actions-send.test-support";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createHostRuntimeStatusContextValue } from "@/test-utils/shared-test-fixtures";
import { useAgentMessageSendPolicy } from "./use-agent-message-send-policy";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";

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
    await expect(
      startSessionWorkflow({
        workspaceId: "workspace-1",
        repoPath: "/tmp/repo",
        launchAttemptId: "conflict",
        request: {
          taskId: "task-1",
          role: "build",
          launchActionId: "build_rebase_conflict_resolution",
          postStartAction: "send_message",
          message: "Resolve conflict",
          assertCanSubmit: harness.getLatest(),
        },
        decision: { startMode: "reuse", sourceSession: getSession(sessionsRef) },
        readSessionSnapshot: () => getSession(sessionsRef),
        client: {
          agentSessionWorkflowLaunch: async () => {
            throw new Error("Unexpected host launch");
          },
          agentSessionWorkflowLaunchRead: async () => [],
          agentSessionWorkflowLaunchRecover: async () => {
            throw new Error("Unexpected recovery");
          },
        },
      }),
    ).rejects.toThrow("finish starting");
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
