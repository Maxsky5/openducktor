import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  toAgentStudioTranscriptTarget,
  toSelectedSessionThreadSession,
} from "./agent-studio-thread-session";

const BUFFERING_MESSAGE =
  "Our systems are thinking a bit more about this request before responding.";

describe("agent studio thread session", () => {
  test("constructs workflow routing in the Agent Studio adapter", () => {
    const identity = toAgentSessionIdentity(
      createAgentSessionFixture({
        externalSessionId: "session-build",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktrees/build",
      }),
    );

    expect(
      toAgentStudioTranscriptTarget({
        identity,
        taskId: "openducktor-1234",
        role: "build",
      }),
    ).toEqual({
      ...identity,
      sessionScope: {
        kind: "workflow",
        taskId: "openducktor-1234",
        role: "build",
      },
    });
  });

  test("projects the runtime status from the matching loaded session", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-buffering",
      runtimeKind: "codex",
      runtimeStatusMessage: BUFFERING_MESSAGE,
    });

    expect(
      toSelectedSessionThreadSession({
        identity: toAgentSessionIdentity(session),
        activityState: "running",
        loadedSession: session,
      })?.runtimeStatusMessage,
    ).toBe(BUFFERING_MESSAGE);
  });

  test("does not project a thread from a different runtime identity", () => {
    const selectedSession = createAgentSessionFixture({
      externalSessionId: "session-shared",
      runtimeKind: "codex",
      workingDirectory: "/repo/selected-worktree",
    });
    const staleLoadedSession = createAgentSessionFixture({
      externalSessionId: "session-shared",
      runtimeKind: "opencode",
      workingDirectory: "/repo/stale-worktree",
      runtimeStatusMessage: BUFFERING_MESSAGE,
    });

    expect(
      toSelectedSessionThreadSession({
        identity: toAgentSessionIdentity(selectedSession),
        activityState: "running",
        loadedSession: staleLoadedSession,
      }),
    ).toBeNull();
  });
});
