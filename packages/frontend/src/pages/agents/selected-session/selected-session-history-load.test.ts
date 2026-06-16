import { describe, expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  shouldLoadSelectedSessionHistory,
  useSelectedSessionHistoryLoad,
} from "./selected-session-history-load";

const selectedSessionIdentity = {
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
} satisfies AgentSessionIdentity;

describe("shouldLoadSelectedSessionHistory", () => {
  test("uses transcript state as the selected-session history load trigger", () => {
    const nonHistoryStates: AgentSessionTranscriptState[] = [
      { kind: "empty" },
      { kind: "runtime_waiting" },
      { kind: "session_loading", reason: "preparing" },
      { kind: "visible" },
      { kind: "failed" },
    ];

    expect(shouldLoadSelectedSessionHistory({ kind: "session_loading", reason: "history" })).toBe(
      true,
    );
    for (const state of nonHistoryStates) {
      expect(shouldLoadSelectedSessionHistory(state)).toBe(false);
    }
  });
});

describe("useSelectedSessionHistoryLoad", () => {
  test("loads the selected session when transcript state requests history", async () => {
    const loadAgentSessionHistory = mock(async () => undefined);

    renderHook(() =>
      useSelectedSessionHistoryLoad({
        selectedSessionIdentity,
        transcriptState: { kind: "session_loading", reason: "history" },
        loadAgentSessionHistory,
      }),
    );

    await waitFor(() => expect(loadAgentSessionHistory).toHaveBeenCalledTimes(1));
    expect(loadAgentSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
  });

  test("does not load history without a selected session identity", () => {
    const loadAgentSessionHistory = mock(async () => undefined);

    renderHook(() =>
      useSelectedSessionHistoryLoad({
        selectedSessionIdentity: null,
        transcriptState: { kind: "session_loading", reason: "history" },
        loadAgentSessionHistory,
      }),
    );

    expect(loadAgentSessionHistory).toHaveBeenCalledTimes(0);
  });

  test("does not load history while the selected session is still preparing", () => {
    const loadAgentSessionHistory = mock(async () => undefined);

    renderHook(() =>
      useSelectedSessionHistoryLoad({
        selectedSessionIdentity,
        transcriptState: { kind: "session_loading", reason: "preparing" },
        loadAgentSessionHistory,
      }),
    );

    expect(loadAgentSessionHistory).toHaveBeenCalledTimes(0);
  });
});
