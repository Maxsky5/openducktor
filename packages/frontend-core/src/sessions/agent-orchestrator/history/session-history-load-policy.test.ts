import { expect, test } from "bun:test";
import { createAgentSessionFixture } from "../../../test-support/shared-test-fixtures";
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

test("a stale baseline shows the loader during refresh and cancellation, and shows again after a failure", () => {
  const current = createAgentSessionFixture({ historyLoadState: "loaded", messages: [] });
  const stale = markSessionHistoryStale(current);
  const refreshing = claimSessionHistoryLoad(stale);
  if (!refreshing) throw new Error("Expected a refresh");
  expect(refreshing.historyLoadState).toBe("refreshing");
  const failed = failSessionHistoryLoad(refreshing, failure);
  const cancelled = abandonSessionHistoryLoad(refreshing);
  const transcriptKind = (session: typeof current) =>
    deriveLoadedAgentSessionTranscriptState({ session, runtimeReadinessState: "ready" }).kind;
  for (const session of [stale, refreshing, failed, cancelled]) {
    expect(session.messages).toBe(current.messages);
  }
  for (const session of [stale, refreshing, cancelled]) {
    expect(transcriptKind(session)).toBe("session_loading");
  }
  expect(transcriptKind(failed)).toBe("visible");
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
