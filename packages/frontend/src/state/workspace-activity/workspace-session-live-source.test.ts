import { expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshotEnvelope,
} from "@openducktor/contracts";
import { createLiveSnapshotEnvelope } from "@openducktor/frontend-core/test-support/agent-session-live-fixture";
import { createWorkspaceActivityObserver } from "@openducktor/frontend-core/workspace-activity/workspace-activity-observer";
import { createWorkspaceSessionLiveSource } from "./workspace-session-live-source";

const input = { repoPath: "/repo" };
const sessionRef = {
  ...input,
  runtimeKind: "opencode" as const,
  externalSessionId: "native",
  workingDirectory: "/repo",
};

test.each([false, true])(
  "keeps a replacement workspace observation after immediate dispose and reopen, opening=%s",
  async (opening) => {
    const pending = Promise.withResolvers<void>();
    const stopped = Promise.withResolvers<void>();
    const transports: Array<{
      emit: (envelope: AgentSessionLiveEnvelope) => void;
      stop: () => void;
    }> = [];
    const source = createWorkspaceSessionLiveSource(
      async (_input, emit) => {
        const first = transports.length === 0;
        const transport = {
          emit,
          stop: mock(() => {
            if (first) stopped.resolve();
          }),
        };
        transports.push(transport);
        if (opening && transports.length === 1) await pending.promise;
        return transport.stop;
      },
      async () => createLiveSnapshotEnvelope({ sequence: 1, sessions: [] }),
    );
    const observer = createWorkspaceActivityObserver({
      observe: source.observeWorkspace,
      archivedSessions: {
        load: async () => {},
        read: () => ({ status: "ready", keys: new Set<string>() }),
        subscribe: () => () => {},
      },
    });
    const workspaces = [{ workspaceId: "workspace", ...input }];
    const received: AgentSessionLiveEnvelope[] = [];
    observer.syncWorkspaces(workspaces);
    observer.dispose();
    // Controllers remount before the activity provider starts its replacement observation.
    const subscription = source.observeAgentSessionLive(input, (envelope) =>
      received.push(envelope),
    );
    observer.syncWorkspaces(workspaces);
    try {
      const unsubscribe = await subscription;
      pending.resolve();
      await stopped.promise;
      const obsolete = createLiveSnapshotEnvelope({ sequence: 10, sessions: [] });
      const current = createLiveSnapshotEnvelope({ sequence: 2, sessions: [] });
      transports[0]!.emit(obsolete);
      transports[1]!.emit(current);
      expect(received.map((envelope) => envelope.type === "snapshot" && envelope.sequence)).toEqual(
        [1, 2],
      );
      expect(observer.getWorkspaceProjection("workspace")?.hasSnapshot).toBe(true);
      expect(transports[0]!.stop).toHaveBeenCalledTimes(1);
      expect(transports[1]!.stop).not.toHaveBeenCalled();
      unsubscribe();
    } finally {
      pending.resolve();
      observer.dispose();
    }
    expect(transports[1]!.stop).toHaveBeenCalledTimes(1);
  },
);

test("installs recovery snapshots after a host sequence reset and keeps later changes", async () => {
  let emit!: (envelope: AgentSessionLiveEnvelope) => void;
  const source = createWorkspaceSessionLiveSource(
    async (_input, listener) => {
      emit = listener;
      return () => {};
    },
    async () => createLiveSnapshotEnvelope({ sequence: 100, sessions: [] }),
  );
  const activity: AgentSessionLiveEnvelope[] = [];
  const received: AgentSessionLiveEnvelope[] = [];
  const release = await source.observeWorkspace(input, (envelope) => activity.push(envelope));
  const unsubscribe = await source.observeAgentSessionLive(input, (envelope) =>
    received.push(envelope),
  );
  try {
    const recovery = createLiveSnapshotEnvelope({
      sequence: 1,
      sessions: [],
      isConnectionSnapshot: true,
      historyReplayGap: true,
    });
    const removed: AgentSessionLiveEnvelope = {
      type: "session_removed",
      ref: sessionRef,
      sequence: 2,
    };
    const transcript: AgentSessionLiveEnvelope = {
      type: "transcript_event",
      event: {
        type: "assistant_message",
        sessionRef,
        externalSessionId: sessionRef.externalSessionId,
        messageId: "recovered-message",
        message: "New host",
        timestamp: new Date(1000).toISOString(),
      },
    };
    emit(recovery);
    emit(removed);
    emit(transcript);
    expect(received.slice(1)).toEqual([recovery, removed, transcript]);
    expect(activity).toEqual([recovery, removed, transcript]);
  } finally {
    unsubscribe();
    release();
  }
});

test.each(["resolved", "rejected"] as const)(
  "recovery replaces a pending initial read that later %s",
  async (outcome) => {
    const initialRead = Promise.withResolvers<AgentSessionLiveSnapshotEnvelope>();
    const readStarted = Promise.withResolvers<void>();
    let emit!: (envelope: AgentSessionLiveEnvelope) => void;
    const source = createWorkspaceSessionLiveSource(
      async (_input, listener) => {
        emit = listener;
        return () => {};
      },
      async () => {
        readStarted.resolve();
        return initialRead.promise;
      },
    );
    const received: AgentSessionLiveEnvelope[] = [];
    const release = await source.observeWorkspace(input, () => {});
    const subscription = source.observeAgentSessionLive(input, (envelope) =>
      received.push(envelope),
    );
    await readStarted.promise;
    const oldChange: AgentSessionLiveEnvelope = {
      type: "session_removed",
      ref: sessionRef,
      sequence: 101,
    };
    const recovery = createLiveSnapshotEnvelope({
      sequence: 1,
      sessions: [],
      isConnectionSnapshot: true,
      historyReplayGap: true,
    });
    const newChange: AgentSessionLiveEnvelope = {
      type: "session_removed",
      ref: sessionRef,
      sequence: 2,
    };
    emit(oldChange);
    emit(recovery);
    emit(newChange);
    if (outcome === "resolved")
      initialRead.resolve(createLiveSnapshotEnvelope({ sequence: 100, sessions: [] }));
    else initialRead.reject(new Error("Old host disconnected"));
    try {
      const unsubscribe = await subscription;
      expect(received).toEqual([recovery, newChange]);
      unsubscribe();
    } finally {
      release();
    }
  },
);

test("uses a connection snapshot received before the shared transport finishes opening", async () => {
  const snapshot = createLiveSnapshotEnvelope({
    sequence: 1,
    sessions: [],
    isConnectionSnapshot: true,
  });
  const change: AgentSessionLiveEnvelope = {
    type: "session_removed",
    ref: sessionRef,
    sequence: 2,
  };
  const attach = mock(async () => createLiveSnapshotEnvelope({ sequence: 100, sessions: [] }));
  const source = createWorkspaceSessionLiveSource(async (_input, listener) => {
    listener(snapshot);
    listener(change);
    return () => {};
  }, attach);
  const received: AgentSessionLiveEnvelope[] = [];
  const subscription = source.observeAgentSessionLive(input, (envelope) => received.push(envelope));
  const release = await source.observeWorkspace(input, () => {});
  try {
    const unsubscribe = await subscription;
    expect(received).toEqual([snapshot, change]);
    expect(attach).not.toHaveBeenCalled();
    unsubscribe();
  } finally {
    release();
  }
});

test("reports an observation failure and restarts the shared stream only on a controller retry", async () => {
  const stop = mock(() => {});
  const observe = mock(async () => stop);
  observe.mockRejectedValueOnce(new Error("Connection failed"));
  const snapshot = createLiveSnapshotEnvelope({ sequence: 1, sessions: [] });
  const attach = mock(async () => snapshot);
  const source = createWorkspaceSessionLiveSource(observe, attach);
  const activity = mock((_envelope: AgentSessionLiveEnvelope) => {});
  const session = mock((_envelope: AgentSessionLiveEnvelope) => {});
  const release = await source.observeWorkspace(input, activity);
  try {
    await expect(source.observeAgentSessionLive(input, session)).rejects.toThrow(
      "Connection failed",
    );
    expect(observe).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
    expect(activity.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "fault",
      message: "Connection failed",
    });
    const unsubscribe = await source.observeAgentSessionLive(input, session);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(session.mock.calls.at(-1)?.[0]).toMatchObject({ type: "snapshot", sequence: 1 });
    unsubscribe();
    expect(stop).not.toHaveBeenCalled();
  } finally {
    release();
  }
  expect(stop).toHaveBeenCalledTimes(1);
});

test("keeps changes received during attachment and rejects late delivery after workspace closure", async () => {
  const pendingSnapshot = Promise.withResolvers<AgentSessionLiveSnapshotEnvelope>();
  const stop = mock(() => {});
  let emit!: (envelope: AgentSessionLiveEnvelope) => void;
  const source = createWorkspaceSessionLiveSource(
    async (_input, listener) => {
      emit = listener;
      return stop;
    },
    async () => pendingSnapshot.promise,
  );
  const release = await source.observeWorkspace(input, () => {});
  const received: AgentSessionLiveEnvelope[] = [];
  const subscription = source.observeAgentSessionLive(input, (envelope) => received.push(envelope));
  const update: AgentSessionLiveEnvelope = {
    type: "message_queue_updated",
    queue: {
      target: {
        ...input,
        runtimeKind: "opencode",
        externalSessionId: "native",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
      revision: 1,
      entries: [],
      pause: null,
    },
  };
  emit(update);
  pendingSnapshot.resolve(createLiveSnapshotEnvelope({ sequence: 1, sessions: [] }));
  const unsubscribe = await subscription;
  expect(received.map(({ type }) => type)).toEqual(["snapshot", "message_queue_updated"]);
  release();
  emit(update);
  expect(received).toHaveLength(2);
  unsubscribe();
  expect(stop).toHaveBeenCalledTimes(1);
});

test("releases an opening transport when a workspace closes before observation completes", async () => {
  const pending = Promise.withResolvers<() => void>();
  const stopped = Promise.withResolvers<void>();
  const stop = mock(() => {
    stopped.resolve();
  });
  const source = createWorkspaceSessionLiveSource(
    async () => pending.promise,
    mock(async () => createLiveSnapshotEnvelope({ sequence: 1, sessions: [] })),
  );
  const release = await source.observeWorkspace(input, () => {});
  const subscription = source.observeAgentSessionLive(input, () => {});
  release();
  await expect(subscription).rejects.toThrow("closed during session attachment");
  pending.resolve(stop);
  await stopped.promise;
  expect(stop).toHaveBeenCalledTimes(1);
});
