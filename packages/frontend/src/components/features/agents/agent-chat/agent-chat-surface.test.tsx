import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createChatSettingsFixture,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { upsertSessionMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { createAnimationFrameTestDriver } from "@openducktor/frontend-core/test-support/animation-frame-test-driver";
import type { AgentChatMessageMeta } from "@openducktor/frontend-core/types/agent-orchestrator";
import { AgentChatTranscriptCacheProvider } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-cache-provider";
import { AgentChatSurface } from "./agent-chat";
import type { AgentChatSurfaceModel } from "./agent-chat.types";
import {
  buildBaseModel,
  buildSessionTranscript,
  completeThreadModel,
} from "./agent-chat-test-fixtures";
import {
  buildMessage,
  buildSession,
} from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";

test("shows the tool details of a session again when the user returns to it", async () => {
  const alpha = model("/alpha");
  const beta = model("/beta");
  const view = render(<AgentChatSurface model={alpha} />);
  try {
    const container = alpha.thread.messagesContainerRef.current!;
    await openToolDetails(container);
    expect(screen.getByRole("complementary").textContent).toContain("Output of /alpha");

    view.rerender(<AgentChatSurface model={beta} />);
    expect(screen.queryByRole("complementary")).toBeNull();

    view.rerender(<AgentChatSurface model={alpha} />);
    expect(alpha.thread.messagesContainerRef.current === container).toBe(true);
    expect(screen.getByRole("complementary").textContent).toContain("Output of /alpha");
    expect(container.textContent).toContain("2.0s");
  } finally {
    view.unmount();
  }
});

test("keeps the tool details open and shows the completed result after a hidden session update", async () => {
  const alpha = model("/alpha", "running");
  const beta = model("/beta");
  const source = createAgentSessionFixture({ ...alpha.thread.transcript.session! });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(source);
  const driver = createAnimationFrameTestDriver();
  driver.installAutoFlush();
  const content = (session: AgentChatSurfaceModel) => (
    <AgentSessionsContext.Provider value={store}>
      <AgentChatTranscriptCacheProvider>
        <AgentChatSurface model={session} />
      </AgentChatTranscriptCacheProvider>
    </AgentSessionsContext.Provider>
  );
  const view = render(content(alpha));
  try {
    await openToolDetails(alpha.thread.messagesContainerRef.current!);
    expect(screen.getByRole("complementary").textContent).toContain("Running");
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
    const container = completed.thread.messagesContainerRef.current!;
    await waitFor(() => expect(container.textContent).toContain("2.0s"), { timeout: 500 });
    expect(screen.getByRole("complementary").textContent).toContain("Output of /alpha");
    expect(screen.getByRole("complementary").textContent).toContain("Succeeded");
  } finally {
    view.unmount();
    driver.restore();
  }
});

/** Presses the tool row of the transcript, so the tool details panel shows its call. */
async function openToolDetails(container: HTMLElement): Promise<void> {
  const row = await waitFor(
    () => {
      const button = container.querySelector<HTMLButtonElement>("button[aria-pressed]");
      if (!button) throw new Error("The transcript has no tool row with details.");
      return button;
    },
    { timeout: 500 },
  );
  act(() => fireEvent.click(row));
}

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
