import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { createAgentSessionLiveAttachment } from "./agent-session-live-attachment";

const snapshot = {
  type: "snapshot",
  repoPath: "/repo",
  sessions: [],
} as const satisfies AgentSessionLiveEnvelope;

const transcriptEvent = (messageId: string): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    type: "assistant_message",
    externalSessionId: "child-thread",
    messageId,
    message: messageId,
    timestamp: "2026-07-17T08:00:00.000Z",
    sessionRef: {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      externalSessionId: "child-thread",
    },
  },
});

describe("agent session live attachment", () => {
  test("delivers the snapshot first and replays pre-snapshot envelopes in order", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const first = transcriptEvent("first");
    const second = transcriptEvent("second");

    attachment.accept(first);
    attachment.accept(second);
    expect(received).toEqual([]);
    attachment.accept(snapshot);

    expect(received).toEqual([snapshot, first, second]);
  });

  test("ignores unrelated and duplicate snapshots without dropping later deltas", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const delta = transcriptEvent("after-snapshot");

    attachment.accept({ ...snapshot, repoPath: "/other" });
    attachment.accept(snapshot);
    attachment.accept(snapshot);
    attachment.accept(delta);

    expect(received).toEqual([snapshot, delta]);
  });

  test("starts a new snapshot-first epoch after reconnect", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const duringReconnect = transcriptEvent("during-reconnect");

    attachment.accept(snapshot);
    attachment.restart();
    attachment.accept(duringReconnect);
    attachment.accept(snapshot);

    expect(received).toEqual([snapshot, snapshot, duringReconnect]);
  });

  test("preserves buffered transcript events across repeated reconnect signals", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const first = transcriptEvent("first-reconnect");
    const second = transcriptEvent("second-reconnect");

    attachment.accept(snapshot);
    attachment.restart();
    attachment.accept(first);
    attachment.restart();
    attachment.accept(second);
    attachment.accept(snapshot);

    expect(received).toEqual([snapshot, snapshot, first, second]);
  });
});
