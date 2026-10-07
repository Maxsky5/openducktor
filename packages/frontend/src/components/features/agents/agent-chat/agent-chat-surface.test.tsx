import { expect, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import {
  createChatSettingsFixture,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext } from "@/state/app-state-contexts";
import { upsertSessionMessage } from "@/state/operations/agent-orchestrator/support/messages";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import type { AgentChatMessageMeta } from "@/types/agent-orchestrator";
import { AgentChatTranscriptCacheContext } from "./agent-chat-transcript-cache-context";
import { createTranscriptModelCache } from "./agent-chat-transcript-model-cache";
import { AgentChatSurface } from "./agent-chat";
import type { AgentChatSurfaceModel } from "./agent-chat.types";
import {
  buildBaseModel,
  buildMessage,
  buildSession,
  buildSessionTranscript,
  completeThreadModel,
} from "./agent-chat-test-fixtures";

test("keeps expanded tool output when returning to a session in another workspace", async () => {
  const alpha = model("/alpha");
  const beta = model("/beta");
  const view = render(<AgentChatSurface model={alpha} />);
  try {
    await waitFor(() => expect(view.container.querySelector("details.group")).not.toBeNull(), {
      timeout: 500,
    });
    const details = view.container.querySelector<HTMLDetailsElement>("details.group")!;
    act(() => {
      details.open = true;
    });
    const container = alpha.thread.messagesContainerRef.current!;
    view.rerender(<AgentChatSurface model={beta} />);
    await waitFor(
      () =>
        expect(beta.thread.messagesContainerRef.current?.textContent).toContain("Output of /beta"),
      { timeout: 500 },
    );
    view.rerender(<AgentChatSurface model={alpha} />);
    expect(alpha.thread.messagesContainerRef.current === container).toBe(true);
    expect(details.isConnected).toBe(true);
    expect(details.open).toBe(true);
    expect(container.textContent).toContain("Output of /alpha");
    expect(container.textContent).toContain("2.0s");
    expect(container.textContent).not.toContain("Output of /beta");
  } finally {
    view.unmount();
  }
});

test("keeps an expanded tool open and shows its completed result after a hidden session update", async () => {
  const alpha = model("/alpha", "running");
  const beta = model("/beta");
  const source = createAgentSessionFixture({ ...alpha.thread.transcript.session! });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(source);
  const cache = createTranscriptModelCache();
  const driver = createAnimationFrameTestDriver();
  driver.installAutoFlush();
  const content = (session: AgentChatSurfaceModel) => (
    <AgentSessionsContext.Provider value={store}>
      <AgentChatTranscriptCacheContext.Provider value={cache}>
        <AgentChatSurface model={session} />
      </AgentChatTranscriptCacheContext.Provider>
    </AgentSessionsContext.Provider>
  );
  const view = render(content(alpha));
  try {
    const details = view.container.querySelector<HTMLDetailsElement>("details.group")!;
    act(() => {
      details.open = true;
    });
    view.rerender(content(beta));
    const completed = model("/alpha");
    const result = completed.thread.transcript.session!.messages.items[0]!;
    act(() => {
      store.updateSession(source, (current) => ({
        ...current,
        messages: upsertSessionMessage(current, result),
      }));
    });
    await driver.flushTimers(5);
    completed.thread = {
      ...completed.thread,
      transcript: {
        ...buildSessionTranscript({
          ...completed.thread.transcript.session!,
          messages: store.getSessionSnapshot(source)!.messages,
        }),
        repoPath: completed.thread.transcript.repoPath,
      },
    };
    view.rerender(content(completed));
    await waitFor(
      () =>
        expect(completed.thread.messagesContainerRef.current?.textContent).toContain(
          "Output of /alpha",
        ),
      { timeout: 500 },
    );
    expect(details.isConnected).toBe(true);
    expect(details.open).toBe(true);
    expect(completed.thread.messagesContainerRef.current?.textContent).toContain("2.0s");
  } finally {
    view.unmount();
    driver.restore();
  }
});

test("bounds retained transcripts and evicts the least recently visited session", async () => {
  const sessions = Array.from({ length: 7 }, (_, i) => model(`/repo/${i}`));
  const first = sessions[0]!;
  const second = sessions[1]!;
  const view = render(<AgentChatSurface model={first} />);
  try {
    await waitFor(() => expect(first.thread.messagesContainerRef.current).not.toBeNull(), {
      timeout: 500,
    });
    const firstContainer = first.thread.messagesContainerRef.current!;
    view.rerender(<AgentChatSurface model={second} />);
    const secondContainer = second.thread.messagesContainerRef.current!;
    for (const session of sessions.slice(2, 6)) view.rerender(<AgentChatSurface model={session} />);
    expect(firstContainer.isConnected).toBe(true);
    view.rerender(<AgentChatSurface model={sessions[6]!} />);
    expect(firstContainer.isConnected).toBe(false);
    expect(secondContainer.isConnected).toBe(true);
    view.rerender(<AgentChatSurface model={second} />);
    expect(second.thread.messagesContainerRef.current === secondContainer).toBe(true);
  } finally {
    view.unmount();
  }
});

function model(
  repoPath: string,
  status: "running" | "completed" = "completed",
): AgentChatSurfaceModel {
  const meta: Extract<AgentChatMessageMeta, { kind: "tool" }> = {
    kind: "tool",
    partId: "part",
    callId: "call",
    tool: "read",
    toolType: "generic",
    status,
    input: { path: "README.md" },
    startedAtMs: 1000,
  };
  if (status === "completed") {
    meta.endedAtMs = 3000;
    meta.output = `Output of ${repoPath}`;
  }
  return {
    chatSettings: createChatSettingsFixture(),
    thread: completeThreadModel({
      ...buildBaseModel(),
      transcript: {
        ...buildSessionTranscript(
          buildSession({
            externalSessionId: "same-native-id",
            workingDirectory: repoPath,
            messages: [
              buildMessage("tool", "Tool read completed", {
                id: "same-tool-id",
                meta,
              }),
            ],
          }),
        ),
        repoPath,
      },
    }),
  };
}
