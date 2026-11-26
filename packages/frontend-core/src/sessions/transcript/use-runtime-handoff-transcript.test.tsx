import "../../test-support/dom-environment";
import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";
import { agentSessionHistoryQueryKeys } from "../../queries/agent-session-history";
import { acceptedLink, chat, target } from "../../test-support/runtime-handoff-fixture";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import { AgentOperationsContext } from "../session-contexts";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { useRuntimeHandoffTranscript } from "./use-runtime-handoff-transcript";

test("active streaming updates preserve the earlier transcript rows", async () => {
  const timestamp = "2026-11-22T09:00:00.000Z";
  let history: AgentSessionHistoryMessage[] = [
    { messageId: "earlier", role: "assistant", timestamp, text: "Earlier reply", parts: [] },
  ];
  const active = (version: number): AgentChatTranscriptSession => ({
    ...target,
    activityState: null,
    runtimeStatusMessage: null,
    pendingQuestions: [],
    messages: createSessionMessagesState(
      target.externalSessionId,
      [{ id: "active", role: "assistant", content: `Active reply ${version}`, timestamp }],
      version,
    ),
  });
  const operations = createAgentOperationsFixture({ readSessionHistory: async () => history });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
    </QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    (session: AgentChatTranscriptSession) =>
      useRuntimeHandoffTranscript({
        session,
        repoPath: chat.repoPath,
        scope: { kind: "repository", workspaceId: chat.workspaceId },
        links: [{ ...acceptedLink }],
      }),
    { wrapper, initialProps: active(0) },
  );
  try {
    await waitFor(() => expect(result.current?.messages.items).toHaveLength(history.length + 2));
    const earlier = result.current?.messages.items[0];
    const marker = result.current?.messages.items.at(-2);
    expect(marker?.meta).toMatchObject({ reason: "runtime_handoff", title: "Handoff" });
    rerender(active(1));
    expect(result.current?.messages.items.at(-1)?.content).toBe("Active reply 1");
    expect(result.current?.messages.items[0]).toBe(earlier);
    expect(result.current?.messages.items.at(-2)).toBe(marker);

    history = [{ ...history[0]!, text: "Updated earlier reply" }];
    await act(() => queryClient.invalidateQueries({ queryKey: agentSessionHistoryQueryKeys.all }));
    await waitFor(() =>
      expect(result.current?.messages.items[0]?.content).toBe("Updated earlier reply"),
    );
    expect(result.current?.messages.items.at(-1)?.content).toBe("Active reply 1");
  } finally {
    unmount();
    queryClient.clear();
  }
});
