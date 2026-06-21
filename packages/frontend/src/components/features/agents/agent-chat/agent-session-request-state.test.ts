import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRequestState,
  removeAgentSessionRequestValue,
  selectPendingAgentSessionRequestValues,
  setAgentSessionRequestValue,
} from "./agent-session-request-state";

describe("agent session request state", () => {
  test("sets request values without mutating existing session buckets", () => {
    const source: AgentSessionRequestState<boolean> = {
      "opencode:session-1:/repo": { "req-1": true },
    };

    const next = setAgentSessionRequestValue(source, "opencode:session-1:/repo", "req-2", true);

    expect(next).toEqual({
      "opencode:session-1:/repo": { "req-1": true, "req-2": true },
    });
    expect(source).toEqual({
      "opencode:session-1:/repo": { "req-1": true },
    });
  });

  test("removes empty session buckets", () => {
    const source: AgentSessionRequestState<boolean> = {
      "opencode:session-1:/repo": { "req-1": true },
      "codex:session-1:/repo": { "req-1": true },
    };

    const next = removeAgentSessionRequestValue(source, "opencode:session-1:/repo", "req-1");

    expect(next).toEqual({
      "codex:session-1:/repo": { "req-1": true },
    });
  });

  test("selects only values for pending requests in the selected session", () => {
    const source: AgentSessionRequestState<string> = {
      "opencode:session-1:/repo": {
        "req-1": "pending",
        "req-2": "stale",
      },
      "codex:session-1:/repo": {
        "req-1": "different session",
      },
    };

    expect(
      selectPendingAgentSessionRequestValues(source, "opencode:session-1:/repo", ["req-1"]),
    ).toEqual({ "req-1": "pending" });
  });
});
