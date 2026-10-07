import { expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  claimSessionHistoryLoad,
  abandonSessionHistoryLoad,
  failSessionHistoryLoad,
} from "./session-history-load-policy";
import { markSessionHistoryStale } from "./session-history-freshness";
import { deriveLoadedAgentSessionTranscriptState } from "../transcript/session-transcript-state";

const failure = {
  code: "request_failed" as const,
  summary: "History unavailable",
  detail: "Offline",
};

test("current and pending histories do not start another read", () => {
  for (const historyLoadState of ["loaded", "loading", "refreshing"] as const) {
    expect(claimSessionHistoryLoad(createAgentSessionFixture({ historyLoadState }))).toBeNull();
  }
});

test("a stale baseline stays visible during refresh, failure, and cancellation", () => {
  const current = createAgentSessionFixture({ historyLoadState: "loaded", messages: [] });
  const stale = markSessionHistoryStale(current);
  const refreshing = claimSessionHistoryLoad(stale);
  if (!refreshing) throw new Error("Expected a refresh");
  expect(refreshing.historyLoadState).toBe("refreshing");
  const failed = failSessionHistoryLoad(refreshing, failure);
  const cancelled = abandonSessionHistoryLoad(refreshing);
  for (const session of [stale, refreshing, failed, cancelled]) {
    expect(session.messages).toBe(current.messages);
    expect(
      deriveLoadedAgentSessionTranscriptState({ session, runtimeReadinessState: "ready" }).kind,
    ).toBe("visible");
  }
  expect(failed.historyLoadState).toBe("stale");
  expect(failed.historyLoadFailure).toBe(failure);
  expect(claimSessionHistoryLoad(failed)?.historyLoadState).toBe("refreshing");
});

test("an interrupted baseline needs a new read instead of becoming current", () => {
  const current = createAgentSessionFixture({ historyLoadState: "not_requested" });
  const loading = claimSessionHistoryLoad(current);
  if (!loading) throw new Error("Expected a baseline read");
  expect(loading.historyLoadState).toBe("loading");
  expect(markSessionHistoryStale(loading).historyLoadState).toBe("not_requested");
  const failed = failSessionHistoryLoad(loading, failure);
  expect(failed.historyLoadState).toBe("failed");
  expect(claimSessionHistoryLoad(failed)?.historyLoadState).toBe("loading");
});
