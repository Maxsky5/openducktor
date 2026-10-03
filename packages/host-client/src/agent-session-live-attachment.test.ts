import { expect, test } from "bun:test";
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

test("state repair does not repeat a generation change already delivered live", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [{ runtimeKind: "codex" as const, generation: "A" }],
    cursor: { hostEpoch: "host", sequence: 1 },
  };
  attachment.install(baseline);
  attachment.accept({
    type: "runtime_changed",
    scope: { repoPath: "/repo", runtimeKind: "codex" },
    state: "ready",
    runtimeGeneration: "B",
    cursor: { hostEpoch: "host", sequence: 2 },
  });
  attachment.restart();
  attachment.install({
    ...baseline,
    runtimeGenerations: [{ runtimeKind: "codex", generation: "B" }],
    cursor: { hostEpoch: "host", sequence: 3 },
  });
  expect(received.filter((event) => event.type === "runtime_changed")).toHaveLength(1);
});

test("transcript recovery starts after all buffered replay has materialized", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
  attachment.accept({ type: "transcript_gap", repoPath: "/repo", message: "Missing transcript" });
  expect(received).toEqual([
    {
      type: "transcript_gap",
      repoPath: "/repo",
      message: "Missing transcript",
      replayPending: true,
    },
  ]);
  attachment.accept({ ...transcriptEvent("earlier"), cursor: { hostEpoch: "host", sequence: 2 } });
  attachment.install({
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [],
    cursor: { hostEpoch: "host", sequence: 3 },
  });
  expect(received.map((event) => event.type)).toEqual([
    "transcript_gap",
    "snapshot",
    "transcript_event",
    "transcript_gap",
  ]);
  expect(received.at(-1)).not.toHaveProperty("replayPending");
});

test("a direct baseline covers state but keeps transcript content and later ordered changes", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (envelope) =>
    received.push(envelope),
  );
  const cursor = (sequence: number) => ({ hostEpoch: "host", sequence });
  const removal: AgentSessionLiveEnvelope = {
    type: "session_removed",
    ref: {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "old",
    },
    cursor: cursor(1),
  };
  const output = { ...transcriptEvent("covered-content"), cursor: cursor(2) };
  const later = { ...transcriptEvent("later-content"), cursor: cursor(4) };
  attachment.accept({ ...snapshot, repoPath: "/other" });
  attachment.accept(removal);
  attachment.accept(output);
  attachment.restart();
  attachment.accept(later);
  attachment.install({
    repoPath: "/repo",
    sessions: [],
    cursor: cursor(3),
    runtimeGenerations: [],
    complete: true,
    failures: [],
  });
  attachment.accept(later);
  expect(received).toEqual([
    {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      cursor: cursor(3),
      isConnectionSnapshot: true,
    },
    { ...output, stateCovered: true },
    later,
  ]);
});

test("a failed baseline application does not claim its cursor or drop buffered content", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  let fail = true;
  const attachment = createAgentSessionLiveAttachment("/repo", (envelope) => {
    if (envelope.type === "snapshot" && fail) throw new Error("application failed");
    received.push(envelope);
  });
  const output = { ...transcriptEvent("buffered"), cursor: { hostEpoch: "host", sequence: 1 } };
  attachment.accept(output);
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    cursor: { hostEpoch: "host", sequence: 2 },
    runtimeGenerations: [],
    complete: true,
    failures: [],
  };
  expect(() => attachment.install(baseline)).toThrow("application failed");
  expect(received).toEqual([]);
  fail = false;
  attachment.install(baseline);
  expect(received.at(-1)).toEqual({ ...output, stateCovered: true });
});

test("old host frames cannot overwrite a replacement baseline", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (envelope) =>
    received.push(envelope),
  );
  attachment.install({
    repoPath: "/repo",
    sessions: [],
    cursor: { hostEpoch: "new-host", sequence: 0 },
    runtimeGenerations: [],
    complete: true,
    failures: [],
  });
  attachment.accept({ ...snapshot, cursor: { hostEpoch: "old-host", sequence: 100 } });
  attachment.accept({
    ...transcriptEvent("obsolete"),
    cursor: { hostEpoch: "old-host", sequence: 101 },
  });
  attachment.accept({
    type: "fault",
    repoPath: "/repo",
    message: "obsolete failure",
    cursor: { hostEpoch: "old-host", sequence: 102 },
  });
  expect(received).toHaveLength(1);
});

test("baseline replacement preserves runtime discontinuity even when state covers its frame", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (envelope) =>
    received.push(envelope),
  );
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    cursor: { hostEpoch: "host", sequence: 1 },
    runtimeGenerations: [{ runtimeKind: "codex" as const, generation: "old" }],
    complete: true,
    failures: [],
  };
  attachment.install(baseline);
  received.length = 0;
  attachment.restart();
  attachment.accept({
    type: "runtime_changed",
    scope: { repoPath: "/repo", runtimeKind: "codex" },
    state: "ready",
    cursor: { hostEpoch: "host", sequence: 2 },
  });
  attachment.install({
    ...baseline,
    cursor: { hostEpoch: "host", sequence: 3 },
    runtimeGenerations: [{ runtimeKind: "codex", generation: "new" }],
  });
  expect(received.filter((event) => event.type === "runtime_changed")).toHaveLength(1);
});

test("a buffered future generation follows the baseline discontinuity and stays remembered", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [{ runtimeKind: "codex" as const, generation: "A" }],
    cursor: { hostEpoch: "host", sequence: 1 },
  };
  attachment.install(baseline);
  attachment.restart();
  attachment.accept({
    type: "runtime_changed",
    scope: { repoPath: "/repo", runtimeKind: "codex" },
    state: "ready",
    runtimeGeneration: "C",
    cursor: { hostEpoch: "host", sequence: 4 },
  });
  attachment.install({
    ...baseline,
    runtimeGenerations: [{ runtimeKind: "codex", generation: "B" }],
    cursor: { hostEpoch: "host", sequence: 3 },
  });
  attachment.restart();
  attachment.install({
    ...baseline,
    runtimeGenerations: [{ runtimeKind: "codex", generation: "C" }],
    cursor: { hostEpoch: "host", sequence: 5 },
  });
  expect(
    received
      .filter((event) => event.type === "runtime_changed")
      .map((event) => event.runtimeGeneration),
  ).toEqual(["B", "C"]);
});

test("a failed runtime delivery leaves the transition available to state repair", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  let fail = true;
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => {
    if (event.type === "runtime_changed" && fail) {
      fail = false;
      throw new Error("delivery failed");
    }
    received.push(event);
  });
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [{ runtimeKind: "codex" as const, generation: "A" }],
    cursor: { hostEpoch: "host", sequence: 1 },
  };
  attachment.install(baseline);
  expect(() =>
    attachment.accept({
      type: "runtime_changed",
      scope: { repoPath: "/repo", runtimeKind: "codex" },
      state: "ready",
      runtimeGeneration: "B",
      cursor: { hostEpoch: "host", sequence: 2 },
    }),
  ).toThrow("delivery failed");
  attachment.restart();
  attachment.install({
    ...baseline,
    runtimeGenerations: [{ runtimeKind: "codex", generation: "B" }],
    cursor: { hostEpoch: "host", sequence: 3 },
  });
  expect(received.filter((event) => event.type === "runtime_changed")).toHaveLength(1);
});

test("rejects a stale baseline without moving the applied cursor backward", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [],
    cursor: { hostEpoch: "host", sequence: 10 },
  };
  attachment.install(baseline);
  attachment.accept({ ...transcriptEvent("live-12"), cursor: { hostEpoch: "host", sequence: 12 } });
  attachment.restart();
  expect(() =>
    attachment.install({ ...baseline, cursor: { hostEpoch: "host", sequence: 11 } }),
  ).toThrow("older than already applied events");
  attachment.accept({ ...transcriptEvent("live-13"), cursor: { hostEpoch: "host", sequence: 13 } });
  attachment.install({ ...baseline, cursor: { hostEpoch: "host", sequence: 12 } });
  expect(
    received
      .filter((event) => event.type === "transcript_event")
      .map((event) => event.cursor?.sequence),
  ).toEqual([12, 13]);
  expect(
    received.filter((event) => event.type === "snapshot").map((event) => event.cursor?.sequence),
  ).toEqual([10, 12]);
});

for (const timing of ["before", "after"] as const) {
  test(`a baseline received ${timing} retained content keeps it once without replaying covered state`, () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
    const cursor = (sequence: number) => ({ hostEpoch: "host", sequence });
    const baseline = {
      repoPath: "/repo",
      sessions: [],
      failures: [],
      complete: true,
      runtimeGenerations: [],
      cursor: cursor(1),
    };
    const prior = { ...transcriptEvent("prior"), cursor: cursor(2) };
    const retained = { ...transcriptEvent("retained"), cursor: cursor(9) };
    const removal: AgentSessionLiveEnvelope = {
      type: "session_removed",
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        externalSessionId: "child-thread",
      },
      cursor: cursor(8),
    };
    attachment.install(baseline);
    attachment.accept(prior);
    attachment.restart();
    if (timing === "before") attachment.install({ ...baseline, cursor: cursor(10) });
    attachment.accept(prior);
    attachment.accept(removal);
    attachment.accept(retained);
    attachment.accept(retained);
    if (timing === "after") attachment.install({ ...baseline, cursor: cursor(10) });
    attachment.accept(retained);
    const later = { ...transcriptEvent("later"), cursor: cursor(11) };
    attachment.accept(later);
    attachment.accept(later);
    expect(received.filter((event) => event.type === "transcript_event")).toEqual([
      prior,
      { ...retained, stateCovered: true },
      later,
    ]);
    expect(received.some((event) => event.type === "session_removed")).toBe(false);
    attachment.restart();
    expect(() => attachment.install({ ...baseline, cursor: cursor(10) })).toThrow(
      "older than already applied events",
    );
  });
}

test("content delivery resets for a new host and rejects old host frames", () => {
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
  const baseline = {
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [],
    cursor: { hostEpoch: "old", sequence: 1 },
  };
  attachment.install(baseline);
  const old = { ...transcriptEvent("old"), cursor: { hostEpoch: "old", sequence: 100 } };
  attachment.accept(old);
  attachment.restart();
  attachment.install({ ...baseline, cursor: { hostEpoch: "new", sequence: 5 } });
  attachment.accept(old);
  const retained = { ...transcriptEvent("new"), cursor: { hostEpoch: "new", sequence: 4 } };
  attachment.accept(retained);
  attachment.accept(retained);
  expect(received.filter((event) => event.type === "transcript_event")).toEqual([
    old,
    { ...retained, stateCovered: true },
  ]);
});

test("a failed covered transcript delivery does not claim its content cursor", () => {
  let fail = true;
  const received: AgentSessionLiveEnvelope[] = [];
  const attachment = createAgentSessionLiveAttachment("/repo", (event) => {
    if (event.type === "transcript_event" && fail) throw new Error("content delivery failed");
    received.push(event);
  });
  attachment.install({
    repoPath: "/repo",
    sessions: [],
    failures: [],
    complete: true,
    runtimeGenerations: [],
    cursor: { hostEpoch: "host", sequence: 10 },
  });
  const retained = { ...transcriptEvent("retained"), cursor: { hostEpoch: "host", sequence: 9 } };
  expect(() => attachment.accept(retained)).toThrow("content delivery failed");
  fail = false;
  attachment.accept(retained);
  attachment.accept(retained);
  expect(received.filter((event) => event.type === "transcript_event")).toEqual([
    { ...retained, stateCovered: true },
  ]);
});

for (const type of ["catalog_invalidated", "slash_command_catalog_updated"] as const) {
  test(`state coverage does not discard ${type} delivered after a baseline`, () => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
    attachment.install({
      repoPath: "/repo",
      sessions: [],
      failures: [],
      complete: true,
      runtimeGenerations: [],
      cursor: { hostEpoch: "host", sequence: 10 },
    });
    const scope = { repoPath: "/repo", runtimeKind: "codex" as const, workingDirectory: "/repo" };
    const cursor = { hostEpoch: "host", sequence: 9 };
    const catalog: AgentSessionLiveEnvelope =
      type === "catalog_invalidated"
        ? { type, scope, cursor }
        : { type, scope, cursor, catalog: { commands: [] } };
    attachment.accept(catalog);
    attachment.accept(catalog);
    expect(received).toHaveLength(2);
    expect(received.at(-1)).toEqual(catalog);
  });
}
