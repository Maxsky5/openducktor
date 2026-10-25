import { expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { createAgentSessionFixture } from "../../../test-support/shared-test-fixtures";
import type { AgentSessionState } from "../../../types/agent-orchestrator";
import {
  markSessionHistoryStale,
  markSessionHistoryUnverified,
  settleUnverifiedSessionHistory,
} from "./session-history-freshness";

const approval = (requestId: string) => ({
  requestId,
  requestType: "permission_grant" as const,
  title: "Approve permission",
});

const unverified = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  markSessionHistoryUnverified(
    createAgentSessionFixture({
      historyLoadState: "loaded",
      status: "idle",
      executionEpisodeId: "episode-1",
      ...overrides,
    }),
  );

const liveSnapshot = (
  session: AgentSessionState,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
    externalSessionId: session.externalSessionId,
  },
  activity: "idle",
  title: "Builder",
  startedAt: session.startedAt,
  executionEpisodeId: "episode-1",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const settledState = (
  session: AgentSessionState,
  snapshot: Partial<AgentSessionLiveSnapshot> | null,
) =>
  settleUnverifiedSessionHistory(session, snapshot ? liveSnapshot(session, snapshot) : undefined)
    .historyLoadState;

test("a coverage gap keeps a loaded transcript until the next snapshot settles it", () => {
  expect(unverified().historyLoadState).toBe("unverified");
  expect(markSessionHistoryStale(unverified()).historyLoadState).toBe("stale");
  for (const historyLoadState of ["refreshing", "stale"] as const) {
    const session = createAgentSessionFixture({ historyLoadState });
    expect(markSessionHistoryUnverified(session).historyLoadState).toBe("stale");
  }
  expect(
    markSessionHistoryUnverified(createAgentSessionFixture({ historyLoadState: "loading" }))
      .historyLoadState,
  ).toBe("not_requested");
});

test("a session that did not work during the gap keeps its transcript", () => {
  expect(settledState(unverified(), {})).toBe("loaded");
  expect(settledState(unverified(), null)).toBe("loaded");
  const waiting = unverified({ status: "running", pendingApprovals: [approval("request-1")] });
  expect(
    settledState(waiting, {
      activity: "waiting_for_permission",
      pendingApprovals: [approval("request-1")],
    }),
  ).toBe("loaded");
});

test("a session that worked during the gap misses messages", () => {
  // A new execution episode: the session started to work again.
  expect(settledState(unverified(), { executionEpisodeId: "episode-2" })).toBe("stale");
  // It worked when coverage ended, or it works now.
  expect(settledState(unverified({ status: "running" }), {})).toBe("stale");
  expect(settledState(unverified({ status: "running" }), null)).toBe("stale");
  expect(settledState(unverified(), { activity: "running" })).toBe("stale");
  // The input that it waited for got an answer.
  const waiting = unverified({ status: "running", pendingApprovals: [approval("request-1")] });
  expect(settledState(waiting, {})).toBe("stale");
  expect(
    settledState(waiting, {
      activity: "waiting_for_permission",
      pendingApprovals: [approval("request-2")],
    }),
  ).toBe("stale");
});

test("only an unverified transcript settles", () => {
  for (const historyLoadState of ["loaded", "stale", "not_requested"] as const) {
    const session = createAgentSessionFixture({ historyLoadState, status: "running" });
    expect(settledState(session, { executionEpisodeId: "episode-2" })).toBe(historyLoadState);
  }
});
