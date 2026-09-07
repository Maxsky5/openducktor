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
  executionEpisodeId: "episode-1",
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
  test.each(["snapshot", "session_upsert"] as const)(
    "reconciles live pending inputs when ownership arrives through %s",
    (type) => {
      let owned = false;
      const projector = createSessionOccurrenceProjector({
        repositoryLabel: "Repo",
        resolveAssociation: () =>
          owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
        resolveTask: () => ({ id: "task-1" }),
      });
      const pending = snapshot({
        pendingApprovals: [
          { requestId: "permission", requestType: "permission_grant", title: "Read" },
        ],
        pendingQuestions: [{ requestId: "question", questions: [] }],
      });
      projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [] });
      expect(projector.accept({ type: "session_upsert", session: pending })).toEqual([]);
      owned = true;
      const event =
        type === "snapshot"
          ? { type, repoPath: "/repo", sessions: [pending] }
          : { type, session: pending };
      expect(projector.accept(event).map((entry) => entry.kind)).toEqual([
        "agent.permission_requested",
        "agent.question_asked",
      ]);
      expect(projector.accept(event)).toEqual([]);
      expect(projector.accept({ type: "session_upsert", session: pending })).toEqual([]);
    },
  );

  test.each(["hydration", "resolved", "removed", "reconnect", "subagent"])(
    "does not replay %s inputs when ownership arrives",
    (scenario) => {
      let owned = false;
      const projector = createSessionOccurrenceProjector({
        repositoryLabel: "Repo",
        resolveAssociation: () =>
          owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
        resolveTask: () => ({ id: "task-1" }),
      });
      const pending = snapshot({
        pendingApprovals: [
          { requestId: "permission", requestType: "permission_grant", title: "Read" },
        ],
      });
      if (scenario === "subagent") pending.parentExternalSessionId = "parent";
      projector.accept({
        type: "snapshot",
        repoPath: "/repo",
        sessions: scenario === "hydration" ? [pending] : [],
      });
      projector.accept({ type: "session_upsert", session: pending });
      if (scenario === "resolved")
        projector.accept({ type: "session_upsert", session: snapshot() });
      if (scenario === "removed") projector.accept({ type: "session_removed", ref });
      owned = true;
      expect(
        projector.accept({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [pending],
          isConnectionSnapshot: scenario === "reconnect",
        }),
      ).toEqual([]);
    },
  );

  test("shares occurrence IDs across late observers and renews them after re-registration", () => {
    const first = createProjector();
    const second = createProjector();
    const baseline = {
      type: "snapshot" as const,
      repoPath: "/repo",
      sessions: [snapshot({ activity: "running" })],
    };
    first.accept(baseline);
    second.accept(baseline);
    const idle = terminalEnvelope("session_idle");
    const [initial] = first.accept(idle);
    expect(initial).toBeDefined();
    expect(second.accept(idle)[0]?.occurrenceId).toBe(initial?.occurrenceId);
    first.accept({ type: "session_removed", ref });
    first.accept({
      type: "session_upsert",
      session: snapshot({ activity: "running", executionEpisodeId: "episode-2" }),
    });
    const [next] = first.accept(terminalEnvelope("session_idle"));
    expect(next).toBeDefined();
    expect(next?.occurrenceId).not.toBe(initial?.occurrenceId);
  });

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
            externalSessionId: ref.externalSessionId,
            runtimeKind: ref.runtimeKind,
            workingDirectory: ref.workingDirectory,
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
      session: snapshot({ activity: "running", executionEpisodeId: "episode-2" }),
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
        occurrenceId: expect.stringContaining("episode-2"),
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
      session: snapshot({ activity: "running", executionEpisodeId: "episode-2" }),
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

    expect(projector.accept(terminalEnvelope("session_idle"))).toMatchObject([
      {
        kind: "agent.session_idle",
        occurrenceId: expect.stringContaining("episode-1"),
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

test.each(["retrying", "waiting_for_permission", "waiting_for_question"] as const)(
  "resets terminal notification state when a new episode starts with %s",
  (activity) => {
    for (const terminal of ["error", "idle"] as const) {
      const projector = createProjector();
      projector.accept({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot({ activity: "running" })],
      });
      const error = transcript({
        type: "session_error",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-09-06T00:00:00.000Z",
        message: "First episode failed",
      });
      expect(projector.accept({ type: "transcript_event", event: error })).toHaveLength(1);
      projector.accept({ type: "session_upsert", session: snapshot({ activity }) });
      expect(projector.accept({ type: "transcript_event", event: error })).toEqual([]);
      expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
      projector.accept({
        type: "session_upsert",
        session: snapshot({ activity, executionEpisodeId: "episode-2" }),
      });
      const finish: AgentSessionLiveEnvelope =
        terminal === "error"
          ? { type: "transcript_event", event: { ...error, timestamp: "2026-09-06T00:01:00.000Z" } }
          : terminalEnvelope("session_idle");
      const notices = projector.accept(finish);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        kind: terminal === "error" ? "agent.session_error" : "agent.session_idle",
        occurrenceId: expect.stringContaining("episode-2"),
      });
      projector.accept({
        type: "session_upsert",
        session: snapshot({ activity, executionEpisodeId: "episode-2" }),
      });
      expect(projector.accept(finish)).toEqual([]);
    }
  },
);

test("clears assistant text when an active snapshot moves directly to a new episode", () => {
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
      messageId: "old",
      message: "Old episode output",
      timestamp: "2026-09-06T00:00:00.000Z",
    }),
  });
  projector.accept({
    type: "session_upsert",
    session: snapshot({ activity: "waiting_for_question", executionEpisodeId: "episode-2" }),
  });
  expect(projector.accept(terminalEnvelope("session_idle"))).toMatchObject([
    { kind: "agent.session_idle", status: "Agent Session is idle." },
  ]);
});

const terminalEnvelope = (
  type:
    | "session_error"
    | "turn_error"
    | "session_idle"
    | "session_finished"
    | "session_status"
    | "session_upsert",
): AgentSessionLiveEnvelope => {
  if (type === "session_upsert") return { type, session: snapshot() };
  const common = {
    externalSessionId: ref.externalSessionId,
    timestamp: "2026-08-31T10:01:00.000Z",
  };
  if (type === "session_status")
    return {
      type: "transcript_event",
      event: transcript({ ...common, type, status: { type: "idle" } }),
    };
  if (type === "session_idle")
    return { type: "transcript_event", event: transcript({ ...common, type }) };
  return { type: "transcript_event", event: transcript({ ...common, type, message: "Finished" }) };
};

for (const ownership of ["snapshot", "session_upsert"] as const) {
  test.each([
    "session_error",
    "turn_error",
    "session_idle",
    "session_finished",
    "session_status",
  ] as const)(`retains live %s until ownership arrives through ${ownership}`, (type) => {
    let owned = false;
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () =>
        owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
      resolveTask: (id) => ({ id, title: "Owned task" }),
    });
    projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [] });
    projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
    const terminal = terminalEnvelope(type);
    expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
    expect(projector.accept(terminal)).toEqual([]);
    expect(projector.accept(terminal)).toEqual([]);
    owned = true;
    const update: AgentSessionLiveEnvelope =
      ownership === "snapshot"
        ? { type: ownership, repoPath: "/repo", sessions: [snapshot()] }
        : { type: ownership, session: snapshot() };
    expect(projector.accept(update)).toMatchObject([
      {
        kind:
          type === "session_error" || type === "turn_error"
            ? "agent.session_error"
            : "agent.session_idle",
        task: { id: "task-1", title: "Owned task" },
        role: "build",
        navigationTarget: {
          taskId: "task-1",
          session: { externalSessionId: ref.externalSessionId },
        },
      },
    ]);
    expect(projector.accept(terminal)).toEqual([]);
    expect(projector.accept(update)).toEqual([]);
  });
}

test("keeps separate unowned episodes and lets an error replace deferred idle", () => {
  let owned = false;
  const projector = createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: () =>
      owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
    resolveTask: () => ({ id: "task-1" }),
  });
  projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
  projector.accept(terminalEnvelope("session_idle"));
  projector.accept(terminalEnvelope("session_error"));
  projector.accept({
    type: "session_upsert",
    session: snapshot({ activity: "running", executionEpisodeId: "episode-2" }),
  });
  projector.accept(terminalEnvelope("session_error"));
  owned = true;
  const result = projector.accept({
    type: "session_upsert",
    session: snapshot({ executionEpisodeId: "episode-2" }),
  });
  expect(result.map((entry) => entry.kind)).toEqual(["agent.session_error", "agent.session_error"]);
  expect(new Set(result.map((entry) => entry.occurrenceId)).size).toBe(2);
});

test.each(["hydration", "reconnect", "removed", "subagent"] as const)(
  "does not replay %s terminal state after ownership arrives",
  (scenario) => {
    let owned = false;
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () =>
        owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
      resolveTask: () => ({ id: "task-1" }),
    });
    const session = snapshot({ activity: "running" });
    if (scenario === "subagent") session.parentExternalSessionId = "parent";
    if (scenario === "hydration") {
      projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    } else {
      projector.accept({ type: "session_upsert", session });
      projector.accept(terminalEnvelope("session_error"));
    }
    if (scenario === "removed") projector.accept({ type: "session_removed", ref });
    owned = true;
    expect(
      projector.accept({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [scenario === "subagent" ? session : snapshot()],
        isConnectionSnapshot: scenario === "reconnect",
      }),
    ).toEqual([]);
  },
);

test.each(["Session stopped", "Runtime stopped", "  RUNTIME STOPPED  "])(
  "does not notify for %s or its following idle state",
  (message) => {
    const projector = createProjector();
    projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
    expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
    expect(
      projector.accept({
        type: "transcript_event",
        event: transcript({
          type: "session_finished",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-08-31T10:01:00.000Z",
          message,
        }),
      }),
    ).toEqual([]);
    expect(projector.accept(terminalEnvelope("session_idle"))).toEqual([]);
    expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
  },
);

test.each([
  "session_error",
  "turn_error",
  "session_idle",
  "session_finished",
  "session_status",
] as const)("classifies %s after its idle upsert without an early completion", (type) => {
  const projector = createProjector();
  projector.accept({
    type: "snapshot",
    repoPath: "/repo",
    sessions: [snapshot({ activity: "running" })],
  });
  expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
  const terminal = terminalEnvelope(type);
  expect(projector.accept(terminal).map((occurrence) => occurrence.kind)).toEqual([
    type === "session_error" || type === "turn_error"
      ? "agent.session_error"
      : "agent.session_idle",
  ]);
  expect(projector.accept(terminal)).toEqual([]);
  expect(projector.accept(terminalEnvelope("session_idle"))).toEqual([]);
  expect(projector.accept({ type: "session_upsert", session: snapshot() })).toEqual([]);
});

test("does not infer a completion from an idle upsert after reconnect", () => {
  const projector = createProjector();
  projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
  projector.accept({ type: "session_upsert", session: snapshot() });
  projector.accept({
    type: "snapshot",
    repoPath: "/repo",
    isConnectionSnapshot: true,
    sessions: [snapshot()],
  });
  expect(projector.accept(terminalEnvelope("session_idle"))).toEqual([]);
});

test("retains a request that first arrives with the ownership-resolving upsert", () => {
  let owned = false;
  const projector = createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: () =>
      owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
    resolveTask: () => ({ id: "task-1" }),
  });
  projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
  owned = true;
  const update: AgentSessionLiveEnvelope = {
    type: "session_upsert",
    session: snapshot({
      activity: "waiting_for_permission",
      pendingApprovals: [{ requestId: "new", requestType: "permission_grant", title: "Read" }],
    }),
  };
  expect(projector.accept(update)).toMatchObject([{ kind: "agent.permission_requested" }]);
  expect(projector.accept(update)).toEqual([]);
});

test.each([false, true])(
  "keeps observed activity when refresh overtakes the terminal frame, owned=%s",
  (initiallyOwned) => {
    let owned = initiallyOwned;
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () =>
        owned ? { kind: "workflow", taskId: "task-1", role: "build" } : null,
      resolveTask: () => ({ id: "task-1" }),
    });
    projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        messageId: "final",
        message: "The change is complete.",
        timestamp: "2026-09-07T10:00:00.000Z",
      }),
    });
    owned = true;
    expect(
      projector.accept({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] }),
    ).toEqual([]);
    expect(projector.accept(terminalEnvelope("session_idle"))).toMatchObject([
      { kind: "agent.session_idle", status: "The change is complete." },
    ]);
    expect(projector.accept(terminalEnvelope("session_idle"))).toEqual([]);
  },
);

test.each(["session_idle", "session_error"] as const)(
  "keeps the %s notification flag across an owned refresh",
  (type) => {
    const projector = createProjector();
    projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
    expect(projector.accept(terminalEnvelope(type))).toHaveLength(1);
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ activity: "running" })],
    });
    expect(projector.accept(terminalEnvelope(type))).toEqual([]);
    expect(projector.accept(terminalEnvelope("session_idle"))).toEqual([]);
  },
);

test.each(["connection", "new episode"] as const)(
  "clears owned assistant text on a %s snapshot",
  (reset) => {
    const projector = createProjector();
    projector.accept({ type: "session_upsert", session: snapshot({ activity: "running" }) });
    projector.accept({
      type: "transcript_event",
      event: transcript({
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        messageId: "old",
        message: "Old output",
        timestamp: "2026-09-07T10:00:00.000Z",
      }),
    });
    projector.accept({
      type: "snapshot",
      repoPath: "/repo",
      isConnectionSnapshot: reset === "connection",
      sessions: [
        snapshot({
          activity: "running",
          executionEpisodeId: reset === "connection" ? "episode-1" : "episode-2",
        }),
      ],
    });
    expect(projector.accept(terminalEnvelope("session_idle"))).toMatchObject([
      { kind: "agent.session_idle", status: "Agent Session is idle." },
    ]);
  },
);
