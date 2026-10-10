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

const session = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
    externalSessionId: "thread",
  },
  sessionAssociation: { kind: "unbound" },
  activity: "waiting_for_permission",
  title: "Session",
  startedAt: "2026-07-17T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
} as const;
const upsert = (sequence: number): AgentSessionLiveEnvelope => ({
  type: "session_upsert",
  session,
  sequence,
});

const createRecorder = () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
    received.push(envelope);
  });
  return { attachment, received };
};

describe("agent session live attachment", () => {
  test("installs the snapshot first and delivers held changes it does not cover", () => {
    const { attachment, received } = createRecorder();
    const fault = { type: "fault", repoPath: "/repo", message: "Status read failed" } as const;

    attachment.accept(upsert(3));
    attachment.accept(transcriptEvent("first"));
    attachment.accept(fault);
    attachment.accept(upsert(6));
    attachment.accept(transcriptEvent("second"));
    expect(received).toEqual([fault]);
    attachment.install({ ...snapshot, sequence: 5 });

    expect(received).toEqual([
      fault,
      { ...snapshot, sequence: 5, isConnectionSnapshot: true },
      transcriptEvent("first"),
      upsert(6),
      transcriptEvent("second"),
    ]);
  });

  test("drops later state changes that the installed snapshot covers", () => {
    const { attachment, received } = createRecorder();

    attachment.install({ ...snapshot, sequence: 5 });
    attachment.accept({ ...snapshot, repoPath: "/other", sequence: 9 });
    attachment.accept({ ...snapshot, sequence: 4 });
    attachment.accept(upsert(5));
    attachment.accept({ ...snapshot, sequence: 7 });
    attachment.accept(transcriptEvent("after-snapshot"));

    expect(received).toEqual([
      { ...snapshot, sequence: 5, isConnectionSnapshot: true },
      { ...snapshot, sequence: 7 },
      transcriptEvent("after-snapshot"),
    ]);
  });

  test("a restart drops held changes and the next snapshot sets a new sequence bound", () => {
    const { attachment, received } = createRecorder();

    attachment.install({ ...snapshot, sequence: 50 });
    attachment.restart();
    attachment.accept(transcriptEvent("before-gap"));
    attachment.restart();
    attachment.accept(transcriptEvent("after-gap"));
    attachment.accept(upsert(3));
    // A replacement host starts a new sequence.
    attachment.install({ ...snapshot, sequence: 2 });

    expect(received).toEqual([
      { ...snapshot, sequence: 50, isConnectionSnapshot: true },
      { ...snapshot, sequence: 2, isConnectionSnapshot: true },
      transcriptEvent("after-gap"),
      upsert(3),
    ]);
  });

  test("rejects a snapshot without a host sequence", () => {
    const { attachment } = createRecorder();

    expect(() => attachment.install(snapshot)).toThrow("has no host sequence");
  });

  test("forwards complete repository session events unchanged", () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
      received.push(envelope);
    });
    const session = {
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "repository-thread",
      },
      sessionAssociation: { kind: "repository" },
      activity: "idle",
      title: "Repository session",
      startedAt: "2026-07-17T08:00:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    } as const;
    const event = { type: "session_upsert", session } as const;
    const expectedEvent = structuredClone(event);

    attachment.install({ ...snapshot, sequence: 0 });
    attachment.accept(event);

    expect(received).toEqual([
      { ...snapshot, sequence: 0, isConnectionSnapshot: true },
      expectedEvent,
    ]);
  });
});
