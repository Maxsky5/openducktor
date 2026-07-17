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

  test("delivers later ordered snapshots without dropping deltas", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const delta = transcriptEvent("after-snapshot");
    const refreshedSnapshot = { ...snapshot };

    attachment.accept({ ...snapshot, repoPath: "/other" });
    attachment.accept(snapshot);
    attachment.accept(refreshedSnapshot);
    attachment.accept(delta);

    expect(received).toEqual([snapshot, refreshedSnapshot, delta]);
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
    const replayedSnapshot = { ...snapshot };
    const refreshedSnapshot = { ...snapshot };
    attachment.accept(replayedSnapshot);
    attachment.accept(refreshedSnapshot);

    expect(received).toEqual([snapshot, replayedSnapshot, duringReconnect, refreshedSnapshot]);
  });

  test("lets a repair snapshot supersede buffered session state without dropping transcripts", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const staleSession = {
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        externalSessionId: "stale-thread",
      },
      activity: "waiting_for_permission",
      title: "Stale session",
      startedAt: "2026-07-17T08:00:00.000Z",
      pendingApprovals: [
        {
          requestId: "stale-approval",
          requestType: "command_execution",
          title: "Stale approval",
        },
      ],
      pendingQuestions: [],
      contextUsage: null,
    } as const;
    const duringReconnect = transcriptEvent("during-repair");
    const repairSnapshot = { ...snapshot };

    attachment.accept(snapshot);
    attachment.restart();
    attachment.accept({ type: "session_upsert", session: staleSession });
    attachment.accept({ type: "session_removed", ref: staleSession.ref });
    attachment.accept(duringReconnect);
    attachment.accept(repairSnapshot);

    expect(received).toEqual([snapshot, repairSnapshot, duringReconnect]);
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
