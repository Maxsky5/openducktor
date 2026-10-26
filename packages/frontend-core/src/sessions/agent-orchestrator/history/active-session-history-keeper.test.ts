import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../../../test-support/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "../../../types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import {
  KEPT_RECENT_TRANSCRIPTS,
  pickNextKeptHistory,
  startActiveSessionHistoryKeeper,
} from "./active-session-history-keeper";

const session = (
  externalSessionId: string,
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId,
    messages: createSessionMessagesState(externalSessionId),
    ...overrides,
  });

const everyRuntimeReady = () => true;

describe("pickNextKeptHistory", () => {
  test("reads an active session first, then a stale recent transcript", () => {
    const idle = session("idle", { historyLoadState: "not_requested" });
    const stale = session("stale", { historyLoadState: "stale" });
    const working = session("working", { status: "running", historyLoadState: "not_requested" });

    expect(pickNextKeptHistory([idle, stale, working], everyRuntimeReady)).toBe(working);
    expect(pickNextKeptHistory([idle, stale], everyRuntimeReady)).toBe(stale);
    expect(pickNextKeptHistory([idle], everyRuntimeReady)).toBeNull();
  });

  test("keeps only the most recent active sessions current", () => {
    const active = Array.from({ length: KEPT_RECENT_TRANSCRIPTS + 1 }, (_, index) =>
      session(`working-${index}`, {
        status: "running",
        // The first session started last, so it has the most recent activity.
        startedAt: new Date(Date.UTC(2026, 9, 25, 12, 0, 60 - index)).toISOString(),
        historyLoadState: index === KEPT_RECENT_TRANSCRIPTS ? "not_requested" : "loaded",
      }),
    );

    // The oldest active session waits until the user opens it.
    expect(pickNextKeptHistory(active, everyRuntimeReady)).toBeNull();
  });

  test("leaves children, failed reads, and sessions of a runtime that is not ready", () => {
    const child = session("child", {
      status: "running",
      historyLoadState: "not_requested",
      liveParentExternalSessionId: "parent",
    });
    const failed = session("failed", {
      status: "running",
      historyLoadState: "failed",
      historyLoadFailure: {
        code: "request_failed",
        summary: "History read failed.",
        detail: "The runtime stopped.",
      },
    });
    const staleFailure = session("stale-failure", {
      historyLoadState: "stale",
      historyLoadFailure: {
        code: "request_failed",
        summary: "History read failed.",
        detail: "The runtime stopped.",
      },
    });
    const notReady = session("not-ready", { status: "running", historyLoadState: "stale" });

    expect(
      pickNextKeptHistory([child, failed, staleFailure, notReady], (kind) => kind !== "opencode"),
    ).toBeNull();
  });

  test("keeps only the most recent read transcripts current", () => {
    const at = (minute: number) => `2026-10-24T08:${String(minute).padStart(2, "0")}:00.000Z`;
    const recent = Array.from({ length: KEPT_RECENT_TRANSCRIPTS }, (_, index) =>
      session(`recent-${index}`, { historyLoadState: "loaded", startedAt: at(10 + index) }),
    );
    const older = session("older", { historyLoadState: "stale", startedAt: at(1) });

    expect(pickNextKeptHistory([...recent, older], everyRuntimeReady)).toBeNull();
  });
});

describe("startActiveSessionHistoryKeeper", () => {
  const createStore = (initial: AgentSessionState[]) => {
    let sessions = initial;
    const listeners = new Set<() => void>();
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      listSessionSnapshots: () => sessions,
      replace: (next: AgentSessionState[]) => {
        sessions = next;
        for (const listener of listeners) listener();
      },
    };
  };

  test("reads one history at a time and reads again after a later gap", async () => {
    const working = session("working", { status: "running", historyLoadState: "not_requested" });
    const stale = session("stale", { historyLoadState: "stale" });
    const store = createStore([working, stale]);
    const reads: string[] = [];
    let finishRead = () => {};
    const loadHistory = (identity: AgentSessionIdentity) => {
      reads.push(identity.externalSessionId);
      return new Promise<AgentSessionState | null>((resolve) => {
        finishRead = () => {
          store.replace(
            store
              .listSessionSnapshots()
              .map((entry) =>
                entry.externalSessionId === identity.externalSessionId
                  ? { ...entry, historyLoadState: "loaded" }
                  : entry,
              ),
          );
          resolve(null);
        };
      });
    };
    const stop = startActiveSessionHistoryKeeper({
      sessionStore: store,
      loadHistory,
      isRuntimeReady: everyRuntimeReady,
    });

    store.replace(store.listSessionSnapshots());
    expect(reads).toEqual(["working"]);
    finishRead();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toEqual(["working", "stale"]);
    finishRead();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toEqual(["working", "stale"]);

    // A live gap makes the transcripts stale again.
    store.replace(
      store.listSessionSnapshots().map((entry) => ({ ...entry, historyLoadState: "stale" })),
    );
    expect(reads).toEqual(["working", "stale", "working"]);
    stop();
  });

  test("does not read again a session whose read ended without its history", async () => {
    const working = session("working", { status: "running", historyLoadState: "not_requested" });
    const store = createStore([working]);
    const reads: string[] = [];
    const stop = startActiveSessionHistoryKeeper({
      sessionStore: store,
      loadHistory: async (identity) => {
        reads.push(identity.externalSessionId);
        return null;
      },
      isRuntimeReady: everyRuntimeReady,
    });
    await Promise.resolve();
    await Promise.resolve();
    store.replace([working]);

    expect(reads).toEqual(["working"]);
    stop();
  });
});
