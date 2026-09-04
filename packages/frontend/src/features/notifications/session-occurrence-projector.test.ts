import { describe, expect, test } from "bun:test";
import {
  agentSessionTranscriptEventSchema,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshot,
  type AgentSessionTranscriptEvent,
} from "@openducktor/contracts";
import { buildNotificationCopy } from "./notification-copy";
import { createSessionOccurrenceProjector } from "./session-occurrence-projector";

const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktrees/task-1",
  externalSessionId: "session-1",
};

const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref,
  activity: "idle",
  title: "Builder session",
  startedAt: "2026-08-31T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

type WithoutSessionRef<Event> = Event extends AgentSessionTranscriptEvent
  ? Omit<Event, "sessionRef">
  : never;
type TranscriptEventFixture = WithoutSessionRef<AgentSessionTranscriptEvent>;

const transcript = (event: TranscriptEventFixture): AgentSessionTranscriptEvent =>
  agentSessionTranscriptEventSchema.parse({ ...event, sessionRef: ref });

const createProjector = () =>
  createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: () => ({ kind: "workflow", taskId: "task-1", role: "build" }),
    resolveTask: (taskId) => ({ id: taskId, title: "Build notifications" }),
  });

describe("session occurrence projector", () => {
  test("ignores sessions without workflow ownership", () => {
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () => null,
      resolveTask: () => null,
    });

    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({
          pendingApprovals: [
            { requestId: "permission-1", requestType: "permission_grant", title: "Read" },
          ],
        }),
      }),
    ).toEqual([]);
  });

  test("does not expose a runtime-generated session title", () => {
    const projector = createProjector();
    const secretTitle = "Customer token sk-secret-title";
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ title: secretTitle })],
    });

    const [occurrence] = projector.accept({
      type: "session_upsert",
      session: snapshot({
        title: secretTitle,
        pendingApprovals: [
          { requestId: "permission-1", requestType: "permission_grant", title: "Read" },
        ],
      }),
    });

    expect(occurrence).toBeDefined();
    if (!occurrence) throw new Error("Expected a permission notification occurrence.");
    expect(buildNotificationCopy(occurrence).body).not.toContain(secretTitle);
  });

  test("uses snapshots and existing pending inputs only as a baseline", () => {
    const projector = createProjector();
    expect(
      projector.accept({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [
          snapshot({
            activity: "running",
            pendingApprovals: [
              { requestId: "permission-1", requestType: "permission_grant", title: "Read" },
            ],
          }),
        ],
      }),
    ).toEqual([]);

    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({
          activity: "running",
          pendingApprovals: [
            { requestId: "permission-1", requestType: "permission_grant", title: "Read" },
          ],
        }),
      }),
    ).toEqual([]);
  });

  test("emits once for each new direct pending request and ignores subagent requests", () => {
    const projector = createProjector();
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    const permissionUpsert: AgentSessionLiveEnvelope = {
      type: "session_upsert",
      session: snapshot({
        pendingApprovals: [
          { requestId: "permission-1", requestType: "permission_grant", title: "Read" },
        ],
      }),
    };

    expect(projector.accept(permissionUpsert)).toMatchObject([
      {
        kind: "agent.permission_requested",
        occurrenceId: expect.stringContaining("permission-1"),
        navigationTarget: {
          type: "pending_input",
          repoPath: "/repo",
          taskId: "task-1",
          session: {
            externalSessionId: "session-1",
          },
          inputKind: "permission",
          requestId: "permission-1",
        },
      },
    ]);
    expect(projector.accept(permissionUpsert)).toEqual([]);

    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({
          parentExternalSessionId: "parent-session",
          pendingQuestions: [{ requestId: "question-child", questions: [] }],
        }),
      }),
    ).toEqual([]);
  });

  test("merges error frames, gives error priority over idle, and allows a later episode", () => {
    const projector = createProjector();
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ activity: "running" })],
    });
    const turnError = transcript({
      type: "turn_error",
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-08-31T10:01:00.000Z",
      message: "secret runtime error",
    });
    const terminalError = transcript({
      type: "session_error",
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-08-31T10:01:01.000Z",
      message: "same secret runtime error",
    });

    expect(projector.accept({ type: "transcript_event", event: turnError })).toMatchObject([
      {
        kind: "agent.session_error",
        status: "Agent Session reported an error.",
        navigationTarget: {
          type: "session_error",
          errorId: "2026-08-31T10:01:00.000Z",
        },
      },
    ]);
    expect(projector.accept({ type: "transcript_event", event: terminalError })).toEqual([]);
    expect(
      projector.accept({
        type: "transcript_event",
        event: transcript({
          type: "session_idle",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:02.000Z",
        }),
      }),
    ).toEqual([]);

    projector.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running" }),
    });
    const laterError = transcript({
      type: "session_error",
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-08-31T10:03:01.000Z",
      message: "later error",
    });
    expect(projector.accept({ type: "transcript_event", event: laterError })).toMatchObject([
      {
        kind: "agent.session_error",
        occurrenceId: expect.stringContaining("cycle-2"),
        navigationTarget: {
          type: "session_error",
          errorId: "2026-08-31T10:03:01.000Z",
        },
      },
    ]);
  });

  test("uses the last completed assistant message in idle notification copy", () => {
    const projector = createProjector();
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    projector.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running" }),
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:00.000Z",
        messageId: "message-1",
        message: "  Work is complete.\n\nThe checks pass.  ",
      }),
    });

    const [occurrence] = projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:01.000Z",
      }),
    });

    expect(occurrence).toBeDefined();
    if (!occurrence) throw new Error("Expected an idle notification occurrence.");
    expect(buildNotificationCopy(occurrence).body).toBe(
      "Work is complete. The checks pass.\nRepo · Builder",
    );
  });

  test("does not use a retracted assistant message in idle notification copy", () => {
    const projector = createProjector();
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    projector.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running" }),
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:00.000Z",
        messageId: "message-1",
        message: "Superseded response",
      }),
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "transcript_retracted",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:01.000Z",
        messageIds: ["message-1"],
      }),
    });

    const [occurrence] = projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:02.000Z",
      }),
    });

    expect(occurrence).toMatchObject({ status: "Agent Session is idle." });
  });

  test("does not reuse assistant text from a prior running cycle", () => {
    const projector = createProjector();
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ activity: "running" })],
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:00.000Z",
        messageId: "message-1",
        message: "First cycle response",
      }),
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:01:01.000Z",
      }),
    });

    projector.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running" }),
    });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:02:00.000Z",
        messageId: "message-2",
        message: "   ",
      }),
    });
    const [occurrence] = projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:02:01.000Z",
      }),
    });

    expect(occurrence).toMatchObject({ status: "Agent Session is idle." });
  });

  test("emits idle only after observed running and excludes retry, output, and user stop", () => {
    const projector = createProjector();
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    const events: AgentSessionLiveEnvelope[] = [
      {
        type: "transcript_event",
        event: transcript({
          type: "session_status",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:00.000Z",
          status: { type: "retry", attempt: 1, message: "retry", nextEpochMs: 1 },
        }),
      },
      {
        type: "transcript_event",
        event: transcript({
          type: "assistant_message",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:01.000Z",
          messageId: "message-1",
          message: "completed output",
        }),
      },
      {
        type: "transcript_event",
        event: transcript({
          type: "session_finished",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:02.000Z",
          message: "Session stopped",
        }),
      },
    ];
    expect(events.flatMap((event) => projector.accept(event))).toEqual([]);

    projector.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running" }),
    });
    expect(
      projector.accept({
        type: "transcript_event",
        event: transcript({
          type: "session_finished",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:03:00.000Z",
          message: "Finished",
        }),
      }),
    ).toMatchObject([{ kind: "agent.session_idle" }]);
  });

  test("does not start a new cycle from a late busy transcript event", () => {
    const projector = createProjector();
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ activity: "running" })],
    });

    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({ activity: "idle" }),
      }),
    ).toMatchObject([
      {
        kind: "agent.session_idle",
        occurrenceId: expect.stringContaining("cycle-1"),
      },
    ]);

    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "session_status",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-08-31T10:00:00.000Z",
        status: { type: "busy", message: null },
      }),
    });

    expect(
      projector.accept({
        type: "transcript_event",
        event: transcript({
          type: "session_idle",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:00.000Z",
        }),
      }),
    ).toEqual([]);
  });

  test("baselines a newly discovered session and excludes child sessions", () => {
    const projector = createProjector();
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [] });
    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({
          parentExternalSessionId: "parent-session",
          pendingQuestions: [{ requestId: "question-1", questions: [] }],
        }),
      }),
    ).toEqual([]);
    expect(
      projector.accept({
        type: "session_upsert",
        session: snapshot({
          parentExternalSessionId: "parent-session",
          pendingQuestions: [
            { requestId: "question-1", questions: [] },
            { requestId: "question-2", questions: [] },
          ],
        }),
      }),
    ).toEqual([]);
  });
});
