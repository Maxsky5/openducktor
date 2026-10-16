import { afterEach, describe, expect, jest, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { createLiveSnapshotEnvelope } from "@/test-utils/agent-session-live-fixture";
import { createAgentTurnGitSync, TOOL_CHANGE_SETTLE_MS } from "./agent-turn-git-sync";
import { gitQueryKeys } from "./git";

const REPO = "/repo";
const WORKTREE = "/repo/.worktrees/task-1";
const OTHER = "/repo/.worktrees/task-2";

const session = (
  activity: AgentSessionLiveSnapshot["activity"],
  workingDirectory = WORKTREE,
): AgentSessionLiveSnapshot => ({
  ref: { repoPath: REPO, runtimeKind: "codex", workingDirectory, externalSessionId: "s-1" },
  activity,
  title: "Build",
  startedAt: "2026-10-14T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const otherRef = { ...session("idle", OTHER).ref, externalSessionId: "s-2" };

const checkout = { name: "feature", detached: false, revision: "abc" };
const keys = {
  local: gitQueryKeys.localChanges(REPO, WORKTREE, "feature"),
  branchChanges: gitQueryKeys.worktreeStatus(REPO, "refs/remotes/origin/main", WORKTREE, "feature"),
  history: gitQueryKeys.history(REPO, WORKTREE, checkout, "refs/remotes/origin/main"),
  branch: gitQueryKeys.worktreeBranch(REPO, WORKTREE),
  otherLocal: gitQueryKeys.localChanges(REPO, OTHER, "feature"),
};

let queryClient = new QueryClient();
afterEach(() => queryClient.clear());

const seed = (): QueryClient => {
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  for (const key of Object.values(keys)) queryClient.setQueryData(key, { read: 1 });
  return queryClient;
};
const isStale = (key: QueryKey): boolean => queryClient.getQueryState(key)?.isInvalidated === true;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAgentTurnGitSync", () => {
  test("marks the Git reads of a session directory stale when its turn ends unseen", async () => {
    const sync = createAgentTurnGitSync(seed()).observe;

    sync(createLiveSnapshotEnvelope({ repoPath: REPO, sessions: [session("running")] }));
    await settle();
    expect(isStale(keys.local)).toBe(false);

    sync({ type: "session_upsert", session: session("idle") });
    await settle();
    // Local changes, Branch changes, History, and the checkout read again when they show.
    expect(isStale(keys.local)).toBe(true);
    expect(isStale(keys.branchChanges)).toBe(true);
    expect(isStale(keys.history)).toBe(true);
    expect(isStale(keys.branch)).toBe(true);
    // Another directory keeps its reads.
    expect(isStale(keys.otherLocal)).toBe(false);
  });

  test("follows a turn that ends in a task session record update", async () => {
    const sync = createAgentTurnGitSync(seed()).observe;

    sync({ type: "session_upsert", session: session("running") });
    sync({
      type: "task_session_records_updated",
      repoPath: REPO,
      taskId: "task-1",
      agentSessions: [],
      liveSession: session("idle"),
    });
    await settle();
    expect(isStale(keys.local)).toBe(true);
  });

  test("leaves the reads alone for a session that it first sees idle or that stays idle", async () => {
    const sync = createAgentTurnGitSync(seed()).observe;

    sync(createLiveSnapshotEnvelope({ repoPath: REPO, sessions: [session("idle")] }));
    sync({ type: "session_upsert", session: session("idle") });
    await settle();
    expect(isStale(keys.local)).toBe(false);

    // An idle session that ends had no turn to finish.
    sync({ type: "session_removed", ref: session("idle").ref });
    sync(createLiveSnapshotEnvelope({ repoPath: REPO, sessions: [] }));
    await settle();
    expect(isStale(keys.local)).toBe(false);
  });

  test("reads again when the host removes a working session", async () => {
    const sync = createAgentTurnGitSync(seed()).observe;

    sync({ type: "session_upsert", session: session("running") });
    sync({ type: "session_removed", ref: session("running").ref });
    await settle();
    expect(isStale(keys.local)).toBe(true);
    expect(isStale(keys.history)).toBe(true);
    expect(isStale(keys.otherLocal)).toBe(false);

    // A removed session starts again without a known activity.
    queryClient.setQueryData(keys.local, { read: 2 });
    sync({ type: "session_upsert", session: session("idle") });
    await settle();
    expect(isStale(keys.local)).toBe(false);
  });

  test("reads again when a snapshot no longer holds a working session", async () => {
    const sync = createAgentTurnGitSync(seed()).observe;

    sync(
      createLiveSnapshotEnvelope({
        repoPath: REPO,
        sessions: [session("running"), { ...session("idle", OTHER), ref: otherRef }],
      }),
    );
    sync(createLiveSnapshotEnvelope({ repoPath: REPO, sessions: [] }));
    await settle();
    expect(isStale(keys.local)).toBe(true);
    // The idle session had no turn to finish.
    expect(isStale(keys.otherLocal)).toBe(false);
  });

  describe("while a turn runs", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    type TranscriptEnvelope = Extract<AgentSessionLiveEnvelope, { type: "transcript_event" }>;
    type ToolPart = Extract<
      Extract<TranscriptEnvelope["event"], { type: "assistant_part" }>["part"],
      { kind: "tool" }
    >;
    const toolCall = (
      toolType: ToolPart["toolType"],
      status: ToolPart["status"],
      provenance?: TranscriptEnvelope["provenance"],
    ): TranscriptEnvelope => {
      const envelope: TranscriptEnvelope = {
        type: "transcript_event",
        event: {
          type: "assistant_part",
          externalSessionId: "s-1",
          timestamp: "2026-10-16T08:00:00.000Z",
          sessionRef: session("running").ref,
          part: {
            kind: "tool",
            messageId: "m-1",
            partId: `p-${toolType}-${status}`,
            callId: "c-1",
            tool: toolType,
            toolType,
            status,
          },
        },
      };
      if (provenance) envelope.provenance = provenance;
      return envelope;
    };

    test("reads the directory once after a burst of edits and commands", async () => {
      jest.useFakeTimers();
      const sync = createAgentTurnGitSync(seed());
      sync.observe({ type: "session_upsert", session: session("running") });

      sync.observe(toolCall("file_edit", "completed"));
      jest.advanceTimersByTime(TOOL_CHANGE_SETTLE_MS - 1);
      sync.observe(toolCall("bash", "error"));
      jest.advanceTimersByTime(TOOL_CHANGE_SETTLE_MS - 1);
      expect(isStale(keys.local)).toBe(false);

      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      await settle();
      // Local changes, Branch changes, History, and the checkout read again, in place.
      expect(isStale(keys.local)).toBe(true);
      expect(isStale(keys.history)).toBe(true);
      expect(isStale(keys.branch)).toBe(true);
      expect(isStale(keys.otherLocal)).toBe(false);
    });

    test("leaves the reads alone for reads, running calls, and a replayed baseline", async () => {
      jest.useFakeTimers();
      const sync = createAgentTurnGitSync(seed());
      sync.observe(toolCall("read", "completed"));
      sync.observe(toolCall("file_edit", "running"));
      sync.observe(toolCall("file_edit", "completed", "baseline"));
      jest.advanceTimersByTime(TOOL_CHANGE_SETTLE_MS);
      jest.useRealTimers();
      await settle();
      expect(isStale(keys.local)).toBe(false);
    });

    test("stops a waiting read when the observation ends", async () => {
      jest.useFakeTimers();
      const sync = createAgentTurnGitSync(seed());
      sync.observe(toolCall("file_edit", "completed"));
      sync.dispose();
      jest.advanceTimersByTime(TOOL_CHANGE_SETTLE_MS);
      jest.useRealTimers();
      await settle();
      expect(isStale(keys.local)).toBe(false);
    });
  });
});
