import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot, HostEventEnvelope } from "@openducktor/contracts";
import {
  createLiveSessionPublisher,
  createMcpBridgeStatusPublisher,
  createRuntimeImpactSignal,
} from "./runtime-lifecycle-publisher";

const snapshot = (externalSessionId: string): AgentSessionLiveSnapshot => ({
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

  test("publishes a runtime impact change on the host runtime channel", () => {
    const { bus, published } = createBus();

    createRuntimeImpactSignal(bus)({ type: "session_upsert", session: snapshot("session-1") });

    expect(published).toEqual([
      {
        channel: "openducktor://runtime-changed",
        payload: { type: "runtime_impact_changed", runtimeKinds: ["codex"] },
      },
    ]);
  });

  test("publishes an MCP bridge status change on the host runtime channel", () => {
    const { bus, published } = createBus();
    const status = {
      state: "ready" as const,
      hostUrl: "http://127.0.0.1:4000",
      failure: null,
      updatedAt: "2026-10-03T10:00:00.000Z",
      revision: 1,
    };

    createMcpBridgeStatusPublisher(bus, "host-1")(status);

    expect(published).toEqual([
      {
        channel: "openducktor://runtime-changed",
        payload: { type: "mcp_bridge_changed", hostInstanceId: "host-1", status },
      },
    ]);
  });
});
