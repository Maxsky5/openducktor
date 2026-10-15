import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { createLiveSnapshotEnvelope } from "@/test-utils/agent-session-live-fixture";
import { createAgentTurnGitSync } from "./agent-turn-git-sync";
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
    const sync = createAgentTurnGitSync(seed());

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
    const sync = createAgentTurnGitSync(seed());

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
    const sync = createAgentTurnGitSync(seed());

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
    const sync = createAgentTurnGitSync(seed());

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
    const sync = createAgentTurnGitSync(seed());

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
});
