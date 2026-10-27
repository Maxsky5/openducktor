import { describe, expect, test } from "bun:test";
import { agentSessionStatusFromActivity } from "@openducktor/core";
import {
  toRefreshedRuntimeSnapshot,
  toRuntimeSnapshotFromThread,
} from "./codex-app-server-runtime-snapshot";
import {
  type CodexThreadInventory,
  type CodexThreadSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

const createSession = (liveStatus?: CodexSessionState["liveStatus"]): CodexSessionState => {
  const session: CodexSessionState = {
    summary: {
      externalSessionId: "thread-1",
      sessionAssociation: { kind: "unbound" },
      startedAt: "2026-05-07T00:00:00.000Z",
      status: liveStatus ? agentSessionStatusFromActivity(liveStatus.classification) : "idle",
    },
    systemPrompt: "Use the repo rules.",
    role: null,
    runtimeId: "runtime-1",
    repoPath: "/repo",
    threadId: "thread-1",
    workingDirectory: "/repo",
    taskId: "task-1",
  };

  if (liveStatus) {
    session.liveStatus = liveStatus;
  }

  return session;
};

const createThread = (status: "active" | "idle" = "active"): CodexThreadSnapshot => ({
  id: "thread-1",
  title: "Codex thread",
  cwd: "/repo",
  startedAt: "2026-05-07T00:00:00.000Z",
  updatedAtMs: Date.parse("2026-05-07T00:01:00.000Z"),
  status: codexThreadStatusSnapshot(status),
  parentThreadId: null,
  agentNickname: null,
  agentRole: null,
  subAgentSource: null,
});

const createInventory = ({
  thread = null,
  threadIsLoaded = thread !== null,
}: {
  thread?: CodexThreadSnapshot | null;
  threadIsLoaded?: boolean;
} = {}): CodexThreadInventory => ({
  runtimeId: "runtime-1",
  loadedIds: thread && threadIsLoaded ? new Set([thread.id]) : new Set(),
  threadsById: thread ? new Map([[thread.id, thread]]) : new Map(),
});

describe("toRuntimeSnapshot", () => {
  test("uses a neutral Codex title and does not infer activity from summary status", () => {
    const session = createSession();

    expect(
      toRefreshedRuntimeSnapshot({
        session,
        inventory: createInventory(),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: false,
        hasActiveTurn: true,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "idle",
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-1",
      },
      title: "Codex",
    });
  });

  test("keeps runtime-reported waiting activity behind the shared classifier", () => {
    const session = createSession({ classification: "waiting_for_permission" });

    expect(
      toRefreshedRuntimeSnapshot({
        session,
        inventory: createInventory(),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: false,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "waiting_for_permission",
    });
  });

  test("classifies pending questions before runtime-reported waiting activity", () => {
    const session = createSession({ classification: "waiting_for_permission" });

    expect(
      toRefreshedRuntimeSnapshot({
        session,
        inventory: createInventory(),
        pendingApprovals: [],
        pendingQuestions: [{ requestId: "question-1", questions: [] }],
        directoryMatch: false,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "waiting_for_question",
    });
  });

  test("adds parent linkage for Codex child threads only when thread metadata proves it", () => {
    expect(
      toRuntimeSnapshotFromThread(
        {
          ...createThread("active"),
          id: "child-thread",
          parentThreadId: "parent-thread",
        },
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          externalSessionId: "child-thread",
          workingDirectory: "/repo",
        },
      ),
    ).toMatchObject({
      availability: "runtime",
      parentExternalSessionId: "parent-thread",
      ref: {
        externalSessionId: "child-thread",
      },
    });
    expect(
      toRuntimeSnapshotFromThread(createThread("active"), {
        repoPath: "/repo",
        runtimeKind: "codex",
        externalSessionId: "thread-1",
        workingDirectory: "/repo",
      }),
    ).not.toHaveProperty("parentExternalSessionId");
  });

  test("includes pending input owned by a Codex child thread snapshot", () => {
    expect(
      toRuntimeSnapshotFromThread(
        {
          ...createThread("active"),
          id: "child-thread",
          parentThreadId: "parent-thread",
        },
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          externalSessionId: "child-thread",
          workingDirectory: "/repo",
        },
        {
          pendingApprovals: [
            {
              requestId: "approval-1",
              requestType: "permission_grant",
              title: "Approve write",
            },
          ],
        },
      ),
    ).toMatchObject({
      classification: "waiting_for_permission",
      parentExternalSessionId: "parent-thread",
      pendingApprovals: [
        {
          requestId: "approval-1",
          requestType: "permission_grant",
        },
      ],
    });
  });
});

describe("resolveCodexRuntimeSnapshotSource", () => {
  test("uses thread inventory when local state has no live status", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(),
        inventory: createInventory({ thread: createThread("active") }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "running",
      title: "Codex thread",
    });
  });

  test("uses loaded inventory when no pending input or active turn needs local state", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: {
          ...createSession(codexThreadStatusSnapshot("idle")),
          workingDirectory: "/tmp/repo",
        },
        inventory: createInventory({
          thread: { ...createThread("active"), cwd: "/private/tmp/repo" },
        }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "running",
      title: "Codex thread",
      ref: expect.objectContaining({ workingDirectory: "/tmp/repo" }),
    });
  });

  test("settles a materialized child from unloaded inventory after renderer reload", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(codexThreadStatusSnapshot("active")),
        inventory: createInventory({
          thread: {
            ...createThread("idle"),
            parentThreadId: "parent-thread",
          },
          threadIsLoaded: false,
        }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "idle",
      parentExternalSessionId: "parent-thread",
      title: "Codex thread",
    });
  });

  test("keeps unloaded materialized children live when current work proves activity", () => {
    const session = createSession(codexThreadStatusSnapshot("active"));
    const inventory = createInventory({
      thread: {
        ...createThread("idle"),
        parentThreadId: "parent-thread",
      },
      threadIsLoaded: false,
    });

    expect(
      toRefreshedRuntimeSnapshot({
        session,
        inventory,
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: true,
      }),
    ).toMatchObject({ classification: "running", title: "Codex" });
    expect(
      toRefreshedRuntimeSnapshot({
        session,
        inventory,
        pendingApprovals: [],
        pendingQuestions: [{ requestId: "question-1", questions: [] }],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({ classification: "waiting_for_question", title: "Codex" });
  });

  test("keeps a newly started main session local while unloaded inventory catches up", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(codexThreadStatusSnapshot("active")),
        inventory: createInventory({
          thread: createThread("idle"),
          threadIsLoaded: false,
        }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "running",
      title: "Codex",
    });
  });

  test("does not settle an unloaded child whose inventory status is still running", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(codexThreadStatusSnapshot("active")),
        inventory: createInventory({
          thread: {
            ...createThread("active"),
            parentThreadId: "parent-thread",
          },
          threadIsLoaded: false,
        }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({ classification: "running", title: "Codex" });
  });

  test("keeps active local turns visible while inventory catches up", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(),
        inventory: createInventory({ thread: createThread("idle") }),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: true,
        hasActiveTurn: true,
      }),
    ).toMatchObject({
      availability: "runtime",
      classification: "idle",
      title: "Codex",
    });
  });

  test("keeps proven parent linkage when pending input uses the local snapshot path", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: {
          ...createSession(),
          threadId: "child-thread",
          workingDirectory: "/tmp/repo",
          summary: {
            ...createSession().summary,
            externalSessionId: "child-thread",
          },
        },
        inventory: createInventory({
          thread: {
            ...createThread("active"),
            cwd: "/private/tmp/repo",
            id: "child-thread",
            parentThreadId: "parent-thread",
          },
        }),
        pendingApprovals: [],
        pendingQuestions: [{ requestId: "question-1", questions: [] }],
        directoryMatch: true,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "runtime",
      parentExternalSessionId: "parent-thread",
      ref: {
        externalSessionId: "child-thread",
        workingDirectory: "/tmp/repo",
      },
    });
  });

  test("returns missing only when neither inventory nor local runtime state can prove a runtime snapshot", () => {
    expect(
      toRefreshedRuntimeSnapshot({
        session: createSession(),
        inventory: createInventory(),
        pendingApprovals: [],
        pendingQuestions: [],
        directoryMatch: false,
        hasActiveTurn: false,
      }),
    ).toMatchObject({
      availability: "missing",
      classification: "missing",
    });
  });
});
