import { describe, expect, test } from "bun:test";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import {
  hasLoadedSessionHistory,
  hasRenderableSessionTranscript,
} from "./session-transcript-content";

const message: AgentChatMessage = {
  id: "message-1",
  role: "assistant",
  content: "Hello",
  timestamp: "2026-06-23T10:00:00.000Z",
};

const transcriptContent = ({
  historyLoadState,
  messages = [],
}: {
  historyLoadState: AgentSessionState["historyLoadState"];
  messages?: AgentChatMessage[];
}) => ({
  externalSessionId: "session-1",
  historyLoadState,
  messages: createSessionMessagesState("session-1", messages),
});

describe("session transcript content predicates", () => {
  test("detects loaded session history", () => {
    expect(hasLoadedSessionHistory({ historyLoadState: "loaded" })).toBe(true);
    expect(hasLoadedSessionHistory({ historyLoadState: "failed" })).toBe(false);
  });

  test("treats messages or loaded history as renderable transcript content", () => {
    expect(
      hasRenderableSessionTranscript(
        transcriptContent({ historyLoadState: "not_requested", messages: [message] }),
      ),
    ).toBe(true);
    expect(hasRenderableSessionTranscript(transcriptContent({ historyLoadState: "loaded" }))).toBe(
      true,
    );
    expect(hasRenderableSessionTranscript(transcriptContent({ historyLoadState: "failed" }))).toBe(
      false,
    );
  });
});
