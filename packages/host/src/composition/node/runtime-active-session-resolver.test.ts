import { describe, expect, test } from "bun:test";
import {
  type AgentSessionLiveSnapshot,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createRuntimeActiveSessionResolver } from "./runtime-active-session-resolver";

const snapshot = (
  runtimeKind: RuntimeKind,
  activity: AgentSessionLiveSnapshot["activity"],
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind,
    workingDirectory: "/repo",
    externalSessionId: `${runtimeKind}-session`,
  },
  activity,
  title: `${runtimeKind} session`,
  startedAt: "2026-08-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

describe("createRuntimeActiveSessionResolver", () => {
  test("matches only non-idle sessions for the requested runtime", async () => {
    let sessions = [snapshot("codex", "idle"), snapshot("claude", "running")];
    const resolveActiveSessions = createRuntimeActiveSessionResolver({
      list: () => Effect.succeed(sessions),
    });
    const input = {
      runtimeKind: "codex",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    };

    await expect(Effect.runPromise(resolveActiveSessions(input))).resolves.toBe(false);

    sessions = [snapshot("codex", "waiting_for_permission")];
    await expect(Effect.runPromise(resolveActiveSessions(input))).resolves.toBe(true);
  });
});
