import { expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";

const snapshot: AgentSessionLiveSnapshot = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo",
    externalSessionId: "session",
  },
  activity: "idle",
  title: "Session",
  startedAt: "2026-09-01T00:00:00Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
};

test("shares episode IDs across reads and refreshes, and renews them for later runs", () => {
  const episodes = createAgentSessionExecutionEpisodes();
  const running = { ...snapshot, activity: "running" as const };
  const first = episodes.snapshotWithEpisode(running, true).executionEpisodeId;
  expect(first).toBeString();
  expect(episodes.snapshotWithEpisode(running).executionEpisodeId).toBe(first);
  expect(episodes.replaceSnapshots("/repo", [running])[0]?.executionEpisodeId).toBe(first);
  expect(
    episodes.snapshotWithEpisode({ ...running, activity: "waiting_for_permission" }, true)
      .executionEpisodeId,
  ).toBe(first);
  expect(episodes.snapshotWithEpisode(running, true).executionEpisodeId).toBe(first);
  episodes.snapshotWithEpisode(snapshot, true);
  expect(episodes.snapshotWithEpisode(running, true).executionEpisodeId).not.toBe(first);
});

test("re-registration with the same startedAt gets a new episode ID", () => {
  const episodes = createAgentSessionExecutionEpisodes();
  const first = episodes.snapshotWithEpisode(snapshot).executionEpisodeId;
  episodes.accept({ type: "session_removed", ref: snapshot.ref });
  expect(episodes.snapshotWithEpisode(snapshot).executionEpisodeId).not.toBe(first);
});

test("terminal events close a run without letting reads start another run", () => {
  const episodes = createAgentSessionExecutionEpisodes();
  const running = { ...snapshot, activity: "running" as const };
  const first = episodes.snapshotWithEpisode(running, true).executionEpisodeId;
  for (const type of ["turn_error", "session_error"] as const) {
    episodes.accept({
      type: "transcript_event",
      event: {
        type,
        sessionRef: snapshot.ref,
        externalSessionId: "session",
        timestamp: "2026-09-01T00:01:00Z",
        message: "Failed",
      },
    });
  }
  expect(episodes.snapshotWithEpisode(running).executionEpisodeId).toBe(first);
  expect(episodes.snapshotWithEpisode(running, true).executionEpisodeId).not.toBe(first);
});

test("a replacement snapshot removes only absent sessions in its repository", () => {
  const episodes = createAgentSessionExecutionEpisodes();
  const other = { ...snapshot, ref: { ...snapshot.ref, repoPath: "/other" } };
  const first = episodes.snapshotWithEpisode(snapshot).executionEpisodeId;
  const otherId = episodes.snapshotWithEpisode(other).executionEpisodeId;
  episodes.replaceSnapshots("/repo", []);
  expect(episodes.snapshotWithEpisode(snapshot).executionEpisodeId).not.toBe(first);
  expect(episodes.snapshotWithEpisode(other).executionEpisodeId).toBe(otherId);
});
