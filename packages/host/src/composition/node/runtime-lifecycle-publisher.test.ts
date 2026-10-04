import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  HostEventEnvelope,
} from "@openducktor/contracts";
import {
  createLiveSessionPublisher,
  createRuntimeImpactSignal,
} from "./runtime-lifecycle-publisher";

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo-a",
    runtimeKind: "codex",
    workingDirectory: "/repo-a/worktree",
    externalSessionId,
  },
  activity: "running",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-10-03T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const createBus = () => {
  const published: HostEventEnvelope[] = [];
  return {
    published,
    bus: {
      publish: (envelope: HostEventEnvelope) => void published.push(envelope),
      subscribe: () => () => {},
    },
  };
};

describe("live session publication", () => {
  test("publishes live envelopes on the repository-scoped channel only", () => {
    const { bus, published } = createBus();
    createLiveSessionPublisher(bus)({ type: "session_upsert", session: snapshot("session-1") });

    expect(published.map((envelope) => envelope.channel)).toEqual([
      "openducktor://agent-session-live-event",
    ]);
  });

  test("signals a review impact change only for reviewed session changes", () => {
    const { bus, published } = createBus();
    const signal = createRuntimeImpactSignal(bus);
    const send = (envelope: AgentSessionLiveEnvelope) => {
      published.length = 0;
      signal(envelope);
      return published.map((envelope) => envelope.payload);
    };
    const changed = (runtimeKinds: string[]) => [{ type: "runtime_impact_changed", runtimeKinds }];

    expect(send({ type: "session_upsert", session: snapshot("session-1") })).toEqual(
      changed(["codex"]),
    );
    // Context and transcript progress do not change the review.
    expect(
      send({
        type: "session_upsert",
        session: snapshot("session-1", {
          contextUsage: { totalTokens: 10, providerId: "openai", modelId: "gpt" },
        }),
      }),
    ).toEqual([]);
    expect(
      send({ type: "session_upsert", session: snapshot("session-1", { activity: "idle" }) }),
    ).toEqual(changed(["codex"]));

    // A repository snapshot that no longer lists a session removes it.
    expect(send({ type: "snapshot", repoPath: "/repo-b", sessions: [] })).toEqual([]);
    expect(send({ type: "snapshot", repoPath: "/repo-a", sessions: [] })).toEqual(
      changed(["codex"]),
    );
    expect(send({ type: "session_removed", ref: snapshot("session-1").ref })).toEqual([]);
    expect(
      send({ type: "fault", repoPath: "/repo-a", operation: "test", message: "lost" }),
    ).toEqual([]);
  });
});
